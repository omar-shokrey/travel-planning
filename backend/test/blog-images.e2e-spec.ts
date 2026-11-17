// Before anything that loads AppModule: uploads go to a throwaway folder.
import './support/uploads-env';
import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const uploadsDir = process.env.UPLOADS_DIR as string;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
/** Tiny files that start like a PNG or a JPG, different on every call. */
const png = (): Buffer =>
  Buffer.concat([PNG_SIGNATURE, Buffer.from(randomUUID())]);
const jpg = (): Buffer =>
  Buffer.concat([JPG_SIGNATURE, Buffer.from(randomUUID())]);

interface UploadFile {
  content: Buffer;
  name: string;
  type: string;
}

const pngFiles = (count: number): UploadFile[] =>
  Array.from({ length: count }, (_, index) => ({
    content: png(),
    name: `photo-${index}.png`,
    type: 'image/png',
  }));

describe('Post images (e2e, BLG-10)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  /** What these tests created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];
  const cookies = new Map<string, string>();

  const http = () => request(app.getHttpServer());

  const createActor = async (
    label: string,
    role: Role,
    assignment?: { providerType: ProviderType },
  ) => {
    const user = await users.create({
      name: `BLG-10 ${label}`,
      email: `blg10-${label}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(assignment && {
        assignment: {
          providerType: assignment.providerType,
          providerId: new Types.ObjectId(),
        },
      }),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    cookies.set(label, await sessionCookieFor(app, id));
    return id;
  };

  let authorId: string;

  /** A post of the author, written straight to the database. */
  const createPost = async (fields: Partial<BlogPost> = {}) => {
    const post = await posts.create({
      authorId: new Types.ObjectId(authorId),
      title: 'A post with images',
      body: 'Body',
      status: PostStatus.Draft,
      ...fields,
    });
    const id = post._id.toString();
    createdPostIds.push(id);
    return id;
  };

  const upload = (
    postId: string,
    who: string | undefined,
    files: UploadFile[],
  ) => {
    let call = http().post(`/api/posts/${postId}/images`);
    if (who) {
      call = call.set('Cookie', cookies.get(who) ?? '');
    }
    for (const file of files) {
      call = call.attach('images', file.content, {
        filename: file.name,
        contentType: file.type,
      });
    }
    return call;
  };

  const remove = (postId: string, who: string | undefined, name: string) => {
    const call = http().delete(`/api/posts/${postId}/images/${name}`);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  const storedImages = async (postId: string): Promise<string[]> =>
    (await posts.findById(postId).lean().orFail()).images;

  const fileExists = (name: string) => existsSync(join(uploadsDir, name));

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    posts = app.get<Model<BlogPost>>(getModelToken(BlogPost.name));

    authorId = await createActor('author', Role.User);
    await createActor('other', Role.User);
    await createActor('admin', Role.Admin);
    await createActor('moderator', Role.HotelModerator, {
      providerType: ProviderType.Hotel,
    });
  });

  afterAll(async () => {
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
    // The files this test uploaded, one by one, then the empty folder.
    for (const file of readdirSync(uploadsDir)) {
      unlinkSync(join(uploadsDir, file));
    }
    rmdirSync(uploadsDir);
  });

  describe('adding images', () => {
    it('adds one image and returns the post with its file name', async () => {
      const postId = await createPost();

      const response = await upload(postId, 'author', pngFiles(1));

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(postId);
      const images = response.body.images as string[];
      expect(images).toEqual([expect.stringMatching(/^[0-9a-f-]{36}\.png$/)]);
      expect(await storedImages(postId)).toEqual(images);
      expect(fileExists(images[0])).toBe(true);
      await http().get(`/api/uploads/${images[0]}`).expect(200);
    });

    it('adds several images at once, JPG and PNG, on a published post too', async () => {
      const postId = await createPost({
        status: PostStatus.Published,
        publishedAt: new Date(),
      });

      const response = await upload(postId, 'author', [
        ...pngFiles(2),
        { content: jpg(), name: 'beach.jpg', type: 'image/jpeg' },
      ]);

      expect(response.status).toBe(200);
      expect(response.body.images).toHaveLength(3);
      expect(response.body.images[2]).toMatch(/\.jpg$/);
    });

    it('refuses the 6th image with 400 and stores nothing more', async () => {
      const postId = await createPost();
      await upload(postId, 'author', pngFiles(5)).expect(200);
      const before = await storedImages(postId);
      const filesBefore = readdirSync(uploadsDir).length;

      const response = await upload(postId, 'author', pngFiles(1));

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at most 5 images');
      expect(await storedImages(postId)).toEqual(before);
      expect(readdirSync(uploadsDir)).toHaveLength(filesBefore);
    });

    it('ends with at most 5 images and no extra file after two uploads at the same time', async () => {
      const postId = await createPost();
      const filesBefore = readdirSync(uploadsDir).length;

      const responses = await Promise.all([
        upload(postId, 'author', pngFiles(3)),
        upload(postId, 'author', pngFiles(3)),
      ]);

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 400]);
      const images = await storedImages(postId);
      expect(images).toHaveLength(3);
      // The losing upload deleted the files it had saved.
      expect(readdirSync(uploadsDir)).toHaveLength(filesBefore + 3);
    });

    it('refuses a file that is not a JPG or PNG with 415', async () => {
      const postId = await createPost();
      const filesBefore = readdirSync(uploadsDir).length;

      const response = await upload(postId, 'author', [
        {
          content: Buffer.from('not an image'),
          name: 'fake.png',
          type: 'image/png',
        },
      ]);

      expect(response.status).toBe(415);
      expect(await storedImages(postId)).toEqual([]);
      expect(readdirSync(uploadsDir)).toHaveLength(filesBefore);
    });

    it('refuses an image over 5 MB with 413', async () => {
      const postId = await createPost();
      const filesBefore = readdirSync(uploadsDir).length;
      const big = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(5 * 1024 * 1024)]);

      const response = await upload(postId, 'author', [
        { content: big, name: 'big.png', type: 'image/png' },
      ]);

      expect(response.status).toBe(413);
      expect(await storedImages(postId)).toEqual([]);
      expect(readdirSync(uploadsDir)).toHaveLength(filesBefore);
    });

    it('refuses a request with no file with 400', async () => {
      const postId = await createPost();

      const response = await upload(postId, 'author', []);

      expect(response.status).toBe(400);
    });

    it('refuses another user, an admin and a moderator with 403, and a guest with 401', async () => {
      const postId = await createPost();

      for (const who of ['other', 'admin', 'moderator']) {
        const response = await upload(postId, who, pngFiles(1));
        expect([who, response.status]).toEqual([who, 403]);
      }
      const guest = await upload(postId, undefined, pngFiles(1));
      expect(guest.status).toBe(401);
      expect(guest.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(await storedImages(postId)).toEqual([]);
    });

    it('answers 404 for a post that does not exist and 400 for a malformed id', async () => {
      const missing = await upload(
        new Types.ObjectId().toString(),
        'author',
        pngFiles(1),
      );
      const malformed = await upload('not-an-id', 'author', pngFiles(1));

      expect(missing.status).toBe(404);
      expect(malformed.status).toBe(400);
    });
  });

  describe('removing an image', () => {
    it('takes the image off the post and deletes its file', async () => {
      const postId = await createPost();
      const added = await upload(postId, 'author', pngFiles(2)).expect(200);
      const [first, second] = added.body.images as string[];

      const response = await remove(postId, 'author', first);

      expect(response.status).toBe(200);
      expect(response.body.images).toEqual([second]);
      expect(await storedImages(postId)).toEqual([second]);
      expect(fileExists(first)).toBe(false);
      expect(fileExists(second)).toBe(true);
    });

    it('answers 404 for an image the post does not have, and deletes no file', async () => {
      const postId = await createPost();
      const otherPost = await createPost();
      const added = await upload(otherPost, 'author', pngFiles(1)).expect(200);
      const name = (added.body.images as string[])[0];

      const response = await remove(postId, 'author', name);

      expect(response.status).toBe(404);
      expect(fileExists(name)).toBe(true);
      expect(await storedImages(otherPost)).toEqual([name]);
    });

    it('refuses another user with 403 and a guest with 401, and keeps the image', async () => {
      const postId = await createPost();
      const added = await upload(postId, 'author', pngFiles(1)).expect(200);
      const name = (added.body.images as string[])[0];

      expect((await remove(postId, 'other', name)).status).toBe(403);
      expect((await remove(postId, undefined, name)).status).toBe(401);
      expect(await storedImages(postId)).toEqual([name]);
      expect(fileExists(name)).toBe(true);
    });
  });

  it('documents both routes in Swagger, with the upload answers', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const add = response.body.paths['/api/posts/{id}/images'].post as {
      responses: Record<string, unknown>;
      requestBody: { content: Record<string, unknown> };
    };
    const del = response.body.paths['/api/posts/{id}/images/{imageId}']
      .delete as { responses: Record<string, unknown> };

    expect(Object.keys(add.requestBody.content)).toEqual([
      'multipart/form-data',
    ]);
    expect(Object.keys(add.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '413', '415']),
    );
    expect(Object.keys(del.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
  });
});
