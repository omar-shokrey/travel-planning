import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { Comment } from './../src/blog/models/comment.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';

describe('Comments on a post (e2e, BLG-05)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let comments: Model<Comment>;
  let passwordHash: string;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];
  const createdCommentIds: string[] = [];

  interface TestUser {
    id: string;
    email: string;
  }

  const createUser = async (role: Role = Role.User): Promise<TestUser> => {
    const email = `blg05-${randomUUID()}@example.com`;
    const user = await users.create({
      name: 'BLG-05 Test User',
      email,
      passwordHash,
      role,
      status: UserStatus.Active,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    return { id, email };
  };

  const loginAs = async (user: TestUser): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(200);

    const header = response.headers['set-cookie'] as unknown as string[];
    const accessCookie = header
      .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`))
      ?.split(';')[0];
    expect(accessCookie).toBeDefined();
    return accessCookie!;
  };

  const createPost = async (
    authorId: string,
    status: PostStatus = PostStatus.Published,
  ): Promise<string> => {
    const post = await posts.create({
      authorId: new Types.ObjectId(authorId),
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status,
      publishedAt: status === PostStatus.Published ? new Date() : undefined,
    });
    const id = post._id.toString();
    createdPostIds.push(id);
    return id;
  };

  const comment = async (postId: string, body: unknown, cookie?: string) => {
    const call = request(app.getHttpServer())
      .post(`/api/posts/${postId}/comments`)
      .send(body as object);
    const response = await (cookie ? call.set('Cookie', cookie) : call);
    if (response.status === 201) {
      createdCommentIds.push((response.body as { id: string }).id);
    }
    return response;
  };

  const listComments = (postId: string, query = '') =>
    request(app.getHttpServer()).get(`/api/posts/${postId}/comments${query}`);

  let author: TestUser;
  let reader: TestUser;
  let readerCookie: string;

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD, 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    posts = app.get<Model<BlogPost>>(getModelToken(BlogPost.name));
    comments = app.get<Model<Comment>>(getModelToken(Comment.name));

    author = await createUser();
    reader = await createUser();
    readerCookie = await loginAs(reader);
  });

  afterAll(async () => {
    for (const id of createdCommentIds) {
      await comments.findByIdAndDelete(id);
    }
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('POST /api/posts/:id/comments', () => {
    it('saves a comment by the logged-in user on a published post', async () => {
      const postId = await createPost(author.id);

      const response = await comment(
        postId,
        { body: '  Great tips!  ' },
        readerCookie,
      );

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        postId,
        authorId: reader.id,
        body: 'Great tips!',
        moderation: 'visible',
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      });
    });

    it('keeps the comment count of the post in step', async () => {
      const postId = await createPost(author.id);

      await comment(postId, { body: 'First' }, readerCookie);
      await comment(postId, { body: 'Second' }, readerCookie);

      const post = await posts.findById(postId);
      expect(post?.commentCount).toBe(2);
    });

    it('accepts 500 characters and rejects 501', async () => {
      const postId = await createPost(author.id);

      const atLimit = await comment(
        postId,
        { body: 'a'.repeat(500) },
        readerCookie,
      );
      const overLimit = await comment(
        postId,
        { body: 'a'.repeat(501) },
        readerCookie,
      );

      expect(atLimit.status).toBe(201);
      expect(overLimit.status).toBe(400);
      expect(overLimit.body).toMatchObject({
        message: 'Validation failed',
        errors: [
          { field: 'body', messages: ['body must be at most 500 characters'] },
        ],
      });
    });

    it('rejects an empty comment and a comment of spaces only', async () => {
      const postId = await createPost(author.id);

      const empty = await comment(postId, { body: '' }, readerCookie);
      const spaces = await comment(postId, { body: '    ' }, readerCookie);
      const missing = await comment(postId, {}, readerCookie);

      for (const response of [empty, spaces, missing]) {
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
          errors: [
            {
              field: 'body',
              messages: expect.arrayContaining(['body must not be empty']),
            },
          ],
        });
      }
    });

    it('rejects a client-supplied author or post', async () => {
      const postId = await createPost(author.id);

      const response = await comment(
        postId,
        { body: 'Great tips!', authorId: author.id, postId },
        readerCookie,
      );

      expect(response.status).toBe(400);
    });

    it('answers 401 without login', async () => {
      const postId = await createPost(author.id);

      const response = await comment(postId, { body: 'Great tips!' });

      expect(response.status).toBe(401);
    });

    it('answers 403 for an account that is not a registered user', async () => {
      const postId = await createPost(author.id);
      const admin = await createUser(Role.Admin);
      const adminCookie = await loginAs(admin);

      const response = await comment(
        postId,
        { body: 'Great tips!' },
        adminCookie,
      );

      expect(response.status).toBe(403);
    });

    it('answers 404 for a post that does not exist', async () => {
      const response = await comment(
        new Types.ObjectId().toString(),
        { body: 'Great tips!' },
        readerCookie,
      );

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ message: 'Post not found' });
    });

    it('answers 404 for a draft, even to its own author', async () => {
      const draftId = await createPost(author.id, PostStatus.Draft);
      const authorCookie = await loginAs(author);

      const response = await comment(
        draftId,
        { body: 'Great tips!' },
        authorCookie,
      );

      expect(response.status).toBe(404);
    });

    it('answers 400 for a post id that is not an id', async () => {
      const response = await comment(
        'not-an-id',
        { body: 'Great tips!' },
        readerCookie,
      );

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/posts/:id/comments', () => {
    it('lists the comments oldest first, to a guest too', async () => {
      const postId = await createPost(author.id);
      await comment(postId, { body: 'First' }, readerCookie);
      await comment(postId, { body: 'Second' }, readerCookie);
      await comment(postId, { body: 'Third' }, readerCookie);

      const response = await listComments(postId);

      expect(response.status).toBe(200);
      const body = response.body as {
        items: { body: string }[];
        meta: unknown;
      };
      expect(body.items.map((item) => item.body)).toEqual([
        'First',
        'Second',
        'Third',
      ]);
      expect(body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('pages the comments', async () => {
      const postId = await createPost(author.id);
      await comment(postId, { body: 'First' }, readerCookie);
      await comment(postId, { body: 'Second' }, readerCookie);
      await comment(postId, { body: 'Third' }, readerCookie);

      const response = await listComments(postId, '?page=2&limit=2');

      expect(response.status).toBe(200);
      const body = response.body as {
        items: { body: string }[];
        meta: unknown;
      };
      expect(body.items.map((item) => item.body)).toEqual(['Third']);
      expect(body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('returns an empty list for a post without comments', async () => {
      const postId = await createPost(author.id);

      const response = await listComments(postId);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('answers 404 for a draft and for a post that does not exist', async () => {
      const draftId = await createPost(author.id, PostStatus.Draft);

      const draft = await listComments(draftId);
      const missing = await listComments(new Types.ObjectId().toString());

      expect(draft.status).toBe(404);
      expect(missing.status).toBe(404);
    });

    it('answers 400 for a limit above 50', async () => {
      const postId = await createPost(author.id);

      const response = await listComments(postId, '?limit=51');

      expect(response.status).toBe(400);
    });
  });
});
