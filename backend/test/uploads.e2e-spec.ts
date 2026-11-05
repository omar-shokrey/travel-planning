import './support/uploads-env';
import { Controller, Post, UploadedFile, UploadedFiles } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { Public } from './../src/common/decorators/public.decorator';
import { UploadImage } from './../src/uploads/decorators/upload-image.decorator';
import { UploadImages } from './../src/uploads/decorators/upload-images.decorator';
import { MAX_IMAGE_BYTES } from './../src/uploads/uploads.constants';
import { UploadsModule } from './../src/uploads/uploads.module';
import { UploadsService } from './../src/uploads/uploads.service';
import type { ImageFile } from './../src/uploads/uploads.types';

const uploadsDir = process.env.UPLOADS_DIR as string;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const png = (content = 'png data'): Buffer =>
  Buffer.concat([PNG_SIGNATURE, Buffer.from(content)]);
const jpeg = (content = 'jpeg data'): Buffer =>
  Buffer.concat([JPEG_SIGNATURE, Buffer.from(content)]);

const storedFiles = (): string[] =>
  existsSync(uploadsDir) ? readdirSync(uploadsDir) : [];

/** The part of the Swagger document these tests read. */
interface SwaggerUploadRoute {
  post: {
    requestBody: {
      content: Record<
        string,
        { schema: { properties: Record<string, unknown> } }
      >;
    };
  };
}

/**
 * Throwaway routes that use the upload decorators the way a post, an activity,
 * a hotel and an airline will. No real route accepts images yet.
 */
@Controller('probe-uploads')
class UploadProbeController {
  constructor(private readonly uploads: UploadsService) {}

  @Public()
  @Post('images')
  @UploadImages()
  images(@UploadedFiles() files: ImageFile[] | undefined) {
    this.uploads.assertWithinLimit('post', 0, files?.length ?? 0);
    return this.uploads.saveImages(files);
  }

  @Public()
  @Post('logo')
  @UploadImage()
  logo(@UploadedFile() file: ImageFile | undefined) {
    return this.uploads.saveImage(file);
  }
}

describe('Image uploads (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    rmSync(uploadsDir, { recursive: true, force: true });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, UploadsModule],
      controllers: [UploadProbeController],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(() => {
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('stores a PNG and serves it at the returned URL', async () => {
    const original = png();

    const upload = await request(app.getHttpServer())
      .post('/api/probe-uploads/images')
      .attach('images', original, {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(upload.body).toEqual([
      {
        filename: expect.stringMatching(/^[0-9a-f-]{36}\.png$/),
        url: expect.stringMatching(/^\/api\/uploads\/[0-9a-f-]{36}\.png$/),
        mimeType: 'image/png',
        size: original.length,
      },
    ]);

    const served = await request(app.getHttpServer())
      .get(upload.body[0].url)
      .expect(200);

    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(original.equals(served.body)).toBe(true);
  });

  it('stores several images at once, JPEG included', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/probe-uploads/images')
      .attach('images', png(), { filename: 'a.png', contentType: 'image/png' })
      .attach('images', jpeg(), {
        filename: 'b.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(
      upload.body.map((image: { mimeType: string }) => image.mimeType),
    ).toEqual(['image/png', 'image/jpeg']);
    expect(storedFiles()).toHaveLength(2);
  });

  it('stores the logo of an airline', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/probe-uploads/logo')
      .attach('logo', png(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);

    expect(upload.body.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(storedFiles()).toEqual([upload.body.filename]);
  });

  it.each([
    [
      'a text file that claims to be a PNG',
      Buffer.from('not an image'),
      'fake.png',
      'image/png',
    ],
    [
      'a GIF renamed to .jpg',
      Buffer.from('GIF89a......'),
      'photo.jpg',
      'image/jpeg',
    ],
  ])('rejects %s', async (_label, content, filename, contentType) => {
    const response = await request(app.getHttpServer())
      .post('/api/probe-uploads/images')
      .attach('images', content, { filename, contentType })
      .expect(415);

    expect(response.body).toMatchObject({
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: `${filename} is not a JPG or PNG image`,
      path: '/api/probe-uploads/images',
    });
    expect(storedFiles()).toEqual([]);
  });

  it('rejects an image larger than 5 MB', async () => {
    const tooBig = Buffer.concat([
      PNG_SIGNATURE,
      Buffer.alloc(MAX_IMAGE_BYTES),
    ]);

    const response = await request(app.getHttpServer())
      .post('/api/probe-uploads/images')
      .attach('images', tooBig, {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);

    expect(response.body).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
    });
    expect(storedFiles()).toEqual([]);
  });

  it('rejects more images than a post can have', async () => {
    let upload = request(app.getHttpServer()).post('/api/probe-uploads/images');
    for (let index = 0; index < 6; index++) {
      upload = upload.attach('images', png(`image ${index}`), {
        filename: `${index}.png`,
        contentType: 'image/png',
      });
    }

    const response = await upload.expect(400);

    expect(response.body.message).toBe('A post can have at most 5 images.');
    expect(storedFiles()).toEqual([]);
  });

  it('rejects a request without a file', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe-uploads/images')
      .expect(400);

    expect(response.body.message).toBe('No image was uploaded');
  });

  it('answers an image that does not exist with the standard error body', async () => {
    const url = `/api/uploads/${randomUUID()}.png`;

    const response = await request(app.getHttpServer()).get(url).expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: url,
    });
  });

  it('does not serve files outside the uploads folder', async () => {
    const secret = join(dirname(uploadsDir), `secret-${randomUUID()}.txt`);
    writeFileSync(secret, 'do not serve');

    try {
      const response = await request(app.getHttpServer()).get(
        `/api/uploads/..%2f${basename(secret)}`,
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.text).not.toContain('do not serve');
    } finally {
      rmSync(secret, { force: true });
    }
  });

  it('shows file pickers in Swagger', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = response.body.paths as Record<string, SwaggerUploadRoute>;
    const schemaOf = (route: string, field: string): unknown => {
      const path = Object.keys(paths).find((key) => key.endsWith(route));
      return paths[path as string].post.requestBody.content[
        'multipart/form-data'
      ].schema.properties[field];
    };

    expect(schemaOf('/probe-uploads/images', 'images')).toMatchObject({
      type: 'array',
      items: { type: 'string', format: 'binary' },
    });
    expect(schemaOf('/probe-uploads/logo', 'logo')).toMatchObject({
      type: 'string',
      format: 'binary',
    });
  });
});
