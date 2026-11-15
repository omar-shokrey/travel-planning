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
import { Like } from './../src/blog/models/like.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';

describe('Likes on a post (e2e, BLG-06)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let likes: Model<Like>;
  let passwordHash: string;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];

  interface TestUser {
    id: string;
    email: string;
  }

  const createUser = async (role: Role = Role.User): Promise<TestUser> => {
    const email = `blg06-${randomUUID()}@example.com`;
    const user = await users.create({
      name: 'BLG-06 Test User',
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

  const like = (postId: string, cookie?: string) => {
    const call = request(app.getHttpServer()).post(`/api/posts/${postId}/like`);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const unlike = (postId: string, cookie?: string) => {
    const call = request(app.getHttpServer()).delete(
      `/api/posts/${postId}/like`,
    );
    return cookie ? call.set('Cookie', cookie) : call;
  };

  let author: TestUser;
  let reader: TestUser;
  let readerCookie: string;
  let secondReader: TestUser;
  let secondReaderCookie: string;

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
    likes = app.get<Model<Like>>(getModelToken(Like.name));
    // The unique index must exist before the "like once" tests run.
    await likes.init();

    author = await createUser();
    reader = await createUser();
    readerCookie = await loginAs(reader);
    secondReader = await createUser();
    secondReaderCookie = await loginAs(secondReader);
  });

  afterAll(async () => {
    // A like is found by its exact post and user, the unique key.
    for (const postId of createdPostIds) {
      for (const userId of createdUserIds) {
        await likes.deleteOne({
          postId: new Types.ObjectId(postId),
          userId: new Types.ObjectId(userId),
        });
      }
    }
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('POST /api/posts/:id/like', () => {
    it('likes a published post and shows the like count', async () => {
      const postId = await createPost(author.id);

      const response = await like(postId, readerCookie);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ postId, liked: true, likeCount: 1 });
    });

    it('counts the likes of different users', async () => {
      const postId = await createPost(author.id);

      await like(postId, readerCookie);
      const response = await like(postId, secondReaderCookie);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ postId, liked: true, likeCount: 2 });
    });

    it('answers 409 on a second like and keeps the count', async () => {
      const postId = await createPost(author.id);
      await like(postId, readerCookie);

      const response = await like(postId, readerCookie);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        message: 'You have already liked this post',
      });
      const post = await posts.findById(postId);
      expect(post?.likeCount).toBe(1);
    });

    it('stores one like when the same user likes twice at the same moment', async () => {
      const postId = await createPost(author.id);

      const responses = await Promise.all([
        like(postId, readerCookie),
        like(postId, readerCookie),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const post = await posts.findById(postId);
      expect(post?.likeCount).toBe(1);
      expect(
        await likes.countDocuments({ postId: new Types.ObjectId(postId) }),
      ).toBe(1);
    });

    it('lets an author like their own post', async () => {
      const postId = await createPost(author.id);
      const authorCookie = await loginAs(author);

      const response = await like(postId, authorCookie);

      expect(response.status).toBe(201);
    });

    it('answers 401 without login', async () => {
      const postId = await createPost(author.id);

      const response = await like(postId);

      expect(response.status).toBe(401);
    });

    it('answers 403 for an account that is not a registered user', async () => {
      const postId = await createPost(author.id);
      const admin = await createUser(Role.Admin);
      const adminCookie = await loginAs(admin);

      const response = await like(postId, adminCookie);

      expect(response.status).toBe(403);
    });

    it('answers 404 for a draft and for a post that does not exist', async () => {
      const draftId = await createPost(author.id, PostStatus.Draft);

      const draft = await like(draftId, readerCookie);
      const missing = await like(new Types.ObjectId().toString(), readerCookie);

      expect(draft.status).toBe(404);
      expect(missing.status).toBe(404);
    });

    it('answers 400 for a post id that is not an id', async () => {
      const response = await like('not-an-id', readerCookie);

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/posts/:id/like', () => {
    it('removes my like and shows the new like count', async () => {
      const postId = await createPost(author.id);
      await like(postId, readerCookie);
      await like(postId, secondReaderCookie);

      const response = await unlike(postId, readerCookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ postId, liked: false, likeCount: 1 });
    });

    it('lets me like the post again after removing the like', async () => {
      const postId = await createPost(author.id);
      await like(postId, readerCookie);
      await unlike(postId, readerCookie);

      const response = await like(postId, readerCookie);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ postId, liked: true, likeCount: 1 });
    });

    it('answers 409 when I have not liked the post, and keeps the count', async () => {
      const postId = await createPost(author.id);
      await like(postId, secondReaderCookie);

      const response = await unlike(postId, readerCookie);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        message: 'You have not liked this post',
      });
      const post = await posts.findById(postId);
      expect(post?.likeCount).toBe(1);
    });

    it('answers 401 without login', async () => {
      const postId = await createPost(author.id);

      const response = await unlike(postId);

      expect(response.status).toBe(401);
    });

    it('answers 404 for a post that does not exist', async () => {
      const response = await unlike(
        new Types.ObjectId().toString(),
        readerCookie,
      );

      expect(response.status).toBe(404);
    });
  });
});
