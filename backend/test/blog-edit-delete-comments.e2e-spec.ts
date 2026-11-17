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

const PASSWORD = 'Passw0rdOK';

describe('Edit and delete my comments (e2e, BLG-07)', () => {
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
    const email = `blg07-${randomUUID()}@example.com`;
    const user = await users.create({
      name: 'BLG-07 Test User',
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

  const createPost = async (authorId: string): Promise<string> => {
    const post = await posts.create({
      authorId: new Types.ObjectId(authorId),
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Published,
      publishedAt: new Date(),
    });
    const id = post._id.toString();
    createdPostIds.push(id);
    return id;
  };

  /** Writes a comment through the API, so the post's comment count is right. */
  const writeComment = async (
    postId: string,
    cookie: string,
    body = 'Great tips!',
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(`/api/posts/${postId}/comments`)
      .set('Cookie', cookie)
      .send({ body });
    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    createdCommentIds.push(id);
    return id;
  };

  const edit = (commentId: string, body: unknown, cookie?: string) => {
    const call = request(app.getHttpServer())
      .patch(`/api/comments/${commentId}`)
      .send(body as object);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const remove = (commentId: string, cookie?: string) => {
    const call = request(app.getHttpServer()).delete(
      `/api/comments/${commentId}`,
    );
    return cookie ? call.set('Cookie', cookie) : call;
  };

  let author: TestUser;
  let commenter: TestUser;
  let commenterCookie: string;
  let other: TestUser;
  let otherCookie: string;

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
    commenter = await createUser();
    commenterCookie = await loginAs(commenter);
    other = await createUser();
    otherCookie = await loginAs(other);
  });

  afterAll(async () => {
    for (const id of createdCommentIds) {
      await comments.findByIdAndDelete(id);
    }
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('PATCH /api/comments/:id', () => {
    it('changes the text of my own comment', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);

      const response = await edit(
        commentId,
        { body: '  Even better tips!  ' },
        commenterCookie,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: commentId,
        postId,
        authorId: commenter.id,
        body: 'Even better tips!',
      });
      const stored = await comments.findById(commentId);
      expect(stored?.body).toBe('Even better tips!');
    });

    it('answers 403 for a comment of another user and changes nothing', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);

      const response = await edit(commentId, { body: 'Hijacked' }, otherCookie);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        message: 'You can only edit your own comments',
      });
      const stored = await comments.findById(commentId);
      expect(stored?.body).toBe('Great tips!');
    });

    it('does not let the author of the post edit a comment on it', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);
      const authorCookie = await loginAs(author);

      const response = await edit(
        commentId,
        { body: 'Hijacked' },
        authorCookie,
      );

      expect(response.status).toBe(403);
    });

    it('rejects an empty text, a text of 501 characters and a missing text', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);

      const empty = await edit(commentId, { body: '   ' }, commenterCookie);
      const tooLong = await edit(
        commentId,
        { body: 'a'.repeat(501) },
        commenterCookie,
      );
      const missing = await edit(commentId, {}, commenterCookie);

      expect(empty.status).toBe(400);
      expect(tooLong.status).toBe(400);
      expect(missing.status).toBe(400);
      expect(tooLong.body).toMatchObject({
        errors: [
          { field: 'body', messages: ['body must be at most 500 characters'] },
        ],
      });
    });

    it('rejects a client-supplied author or post', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);

      const response = await edit(
        commentId,
        { body: 'Hello', authorId: other.id, postId },
        commenterCookie,
      );

      expect(response.status).toBe(400);
    });

    it('answers 401 without login', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);

      const response = await edit(commentId, { body: 'Hello' });

      expect(response.status).toBe(401);
    });

    it('answers 404 for a comment that does not exist and 400 for a bad id', async () => {
      const missing = await edit(
        new Types.ObjectId().toString(),
        { body: 'Hello' },
        commenterCookie,
      );
      const badId = await edit('not-an-id', { body: 'Hello' }, commenterCookie);

      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ message: 'Comment not found' });
      expect(badId.status).toBe(400);
    });
  });

  describe('DELETE /api/comments/:id', () => {
    it('deletes my own comment and lowers the comment count of the post', async () => {
      const postId = await createPost(author.id);
      const keptId = await writeComment(postId, otherCookie, 'I stay');
      const commentId = await writeComment(postId, commenterCookie);

      const response = await remove(commentId, commenterCookie);

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(await comments.findById(commentId)).toBeNull();
      expect(await comments.findById(keptId)).not.toBeNull();
      const post = await posts.findById(postId);
      expect(post?.commentCount).toBe(1);
    });

    it('removes the comment from the list of the post', async () => {
      const postId = await createPost(author.id);
      await writeComment(postId, otherCookie, 'I stay');
      const commentId = await writeComment(postId, commenterCookie);

      await remove(commentId, commenterCookie);
      const list = await request(app.getHttpServer()).get(
        `/api/posts/${postId}/comments`,
      );

      const body = list.body as { items: { body: string }[] };
      expect(body.items.map((item) => item.body)).toEqual(['I stay']);
    });

    it('answers 403 for a comment of another user and keeps it', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);

      const response = await remove(commentId, otherCookie);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        message: 'You can only delete your own comments',
      });
      expect(await comments.findById(commentId)).not.toBeNull();
      const post = await posts.findById(postId);
      expect(post?.commentCount).toBe(1);
    });

    it('answers 403 for an account that is not a registered user', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);
      const admin = await createUser(Role.Admin);
      const adminCookie = await loginAs(admin);

      const response = await remove(commentId, adminCookie);

      expect(response.status).toBe(403);
      expect(await comments.findById(commentId)).not.toBeNull();
    });

    it('answers 404 the second time', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);
      await remove(commentId, commenterCookie);

      const response = await remove(commentId, commenterCookie);

      expect(response.status).toBe(404);
      const post = await posts.findById(postId);
      expect(post?.commentCount).toBe(0);
    });

    it('answers 401 without login', async () => {
      const postId = await createPost(author.id);
      const commentId = await writeComment(postId, commenterCookie);

      const response = await remove(commentId);

      expect(response.status).toBe(401);
    });
  });
});
