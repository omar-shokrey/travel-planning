import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { EnvironmentVariables } from '../config/env.validation';
import { MAX_IMAGE_BYTES } from './uploads.constants';
import { UploadsService } from './uploads.service';
import type { ImageFile } from './uploads.types';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const png = (content = 'png data'): Buffer =>
  Buffer.concat([PNG_SIGNATURE, Buffer.from(content)]);
const jpeg = (content = 'jpeg data'): Buffer =>
  Buffer.concat([JPEG_SIGNATURE, Buffer.from(content)]);
const file = (buffer: Buffer, originalname = 'photo.png'): ImageFile => ({
  originalname,
  buffer,
});

function serviceFor(folder: string): UploadsService {
  const config = {
    get: () => folder,
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new UploadsService(config);
}

describe('UploadsService', () => {
  let base: string;
  let directory: string;
  let service: UploadsService;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'uploads-service-'));
    // Not created yet, as on a fresh clone.
    directory = join(base, 'uploads');
    service = serviceFor(directory);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const storedFiles = (): string[] =>
    existsSync(directory) ? readdirSync(directory) : [];

  it('resolves a relative folder against the working directory', () => {
    expect(serviceFor('uploads').directory).toBe(resolve('uploads'));
  });

  describe('saveImage', () => {
    it('stores a PNG under a random name and says where it is served', async () => {
      const original = png();

      const stored = await service.saveImage(file(original));

      expect(stored.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
      expect(stored).toMatchObject({
        url: `/api/uploads/${stored.filename}`,
        mimeType: 'image/png',
        size: original.length,
      });
      expect(
        readFileSync(join(directory, stored.filename)).equals(original),
      ).toBe(true);
    });

    it('stores a JPEG with the .jpg extension', async () => {
      const stored = await service.saveImage(file(jpeg(), 'photo.jpeg'));

      expect(stored.filename).toMatch(/^[0-9a-f-]{36}\.jpg$/);
      expect(stored.mimeType).toBe('image/jpeg');
    });

    it('creates the folder when it does not exist yet', async () => {
      expect(existsSync(directory)).toBe(false);

      await service.saveImage(file(png()));

      expect(storedFiles()).toHaveLength(1);
    });

    it('takes the type from the content, not from the file name', async () => {
      const stored = await service.saveImage(file(jpeg(), 'photo.png'));

      expect(stored.filename).toMatch(/\.jpg$/);
      expect(stored.mimeType).toBe('image/jpeg');
    });

    it('ignores the file name the client sends', async () => {
      const stored = await service.saveImage(file(png(), '../../evil.html'));

      expect(storedFiles()).toEqual([stored.filename]);
      expect(readdirSync(base)).toEqual(['uploads']);
    });

    it.each([
      ['a GIF renamed to .jpg', Buffer.from('GIF89a......'), 'photo.jpg'],
      ['a text file named .png', Buffer.from('<script>1</script>'), 'a.png'],
      ['an empty file', Buffer.alloc(0), 'empty.png'],
    ])('rejects %s', async (_label, buffer, name) => {
      await expect(service.saveImage(file(buffer, name))).rejects.toThrow(
        new UnsupportedMediaTypeException(`${name} is not a JPG or PNG image`),
      );
      expect(storedFiles()).toEqual([]);
    });

    it('accepts a file of exactly 5 MB and rejects one byte more', async () => {
      const exact = Buffer.concat([
        PNG_SIGNATURE,
        Buffer.alloc(MAX_IMAGE_BYTES - PNG_SIGNATURE.length),
      ]);
      const oneByteMore = Buffer.concat([exact, Buffer.alloc(1)]);

      await expect(service.saveImage(file(exact))).resolves.toMatchObject({
        size: MAX_IMAGE_BYTES,
      });
      await expect(
        service.saveImage(file(oneByteMore, 'big.png')),
      ).rejects.toThrow(
        new PayloadTooLargeException('big.png is larger than 5 MB'),
      );
      expect(storedFiles()).toHaveLength(1);
    });

    it('rejects a request without a file', async () => {
      await expect(service.saveImage(undefined)).rejects.toThrow(
        new BadRequestException('No image was uploaded'),
      );
    });
  });

  describe('saveImages', () => {
    it('stores several images, each under its own name', async () => {
      const stored = await service.saveImages([
        file(png('one')),
        file(jpeg('two'), 'two.jpg'),
        file(png('three')),
      ]);

      expect(new Set(stored.map((image) => image.filename)).size).toBe(3);
      expect(storedFiles().sort()).toEqual(
        stored.map((image) => image.filename).sort(),
      );
    });

    it('stores nothing when one of the files is not valid', async () => {
      await expect(
        service.saveImages([file(png()), file(Buffer.from('GIF89a'), 'b.gif')]),
      ).rejects.toThrow(
        new UnsupportedMediaTypeException('b.gif is not a JPG or PNG image'),
      );
      expect(storedFiles()).toEqual([]);
    });

    it.each([[[]], [undefined]])('rejects %j', async (files) => {
      await expect(service.saveImages(files)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertWithinLimit', () => {
    it.each([
      ['post', 0, 5],
      ['post', 3, 2],
      ['activity', 4, 1],
      ['hotel', 0, 5],
      ['airline', 0, 1],
    ] as const)(
      'allows a %s with %i images and %i more',
      (owner, existing, incoming) => {
        expect(() =>
          service.assertWithinLimit(owner, existing, incoming),
        ).not.toThrow();
      },
    );

    it.each([
      ['post', 0, 6, 'A post can have at most 5 images.'],
      ['post', 3, 3, 'A post can have at most 5 images. It already has 3.'],
      [
        'activity',
        5,
        1,
        'An activity can have at most 5 images. It already has 5.',
      ],
      ['hotel', 0, 6, 'A hotel can have at most 5 images.'],
      ['airline', 0, 2, 'An airline can have at most 1 logo.'],
      [
        'airline',
        1,
        1,
        'An airline can have at most 1 logo. It already has 1.',
      ],
    ] as const)(
      'rejects a %s with %i images and %i more',
      (owner, existing, incoming, message) => {
        expect(() =>
          service.assertWithinLimit(owner, existing, incoming),
        ).toThrow(new BadRequestException(message));
      },
    );
  });

  describe('deleteImage', () => {
    it('removes a stored file', async () => {
      const stored = await service.saveImage(file(png()));

      await service.deleteImage(stored.filename);

      expect(storedFiles()).toEqual([]);
    });

    it('does nothing when the file is already gone', async () => {
      await expect(
        service.deleteImage('3f2b8c52-6f0e-4c7e-9d54-1c2d3e4f5a6b.png'),
      ).resolves.toBeUndefined();
    });

    it.each([
      '../outside.png',
      '..\\outside.png',
      'outside.png',
      'photo.gif',
      '/etc/passwd',
      '',
    ])('ignores %j, which is not a name this service gave', async (name) => {
      const outside = join(base, 'outside.png');
      writeFileSync(outside, png());

      await service.deleteImage(name);

      expect(existsSync(outside)).toBe(true);
    });
  });
});
