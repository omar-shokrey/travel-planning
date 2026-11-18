import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { Comment } from './../src/blog/models/comment.schema';
import { Like } from './../src/blog/models/like.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';

const uniqueEmail = (): string => `blg04-${randomUUID()}@example.com`;

describe('PATCH/DELETE /api/posts/:id (e2e, BLG-04)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let comments: Model<Comment>;
  let likes: Model<Like>;
  let passwordHash: string;

  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];
  const createdCommentIds: string[] = [];
  const createdLikeIds: string[] = [];

  interface TestUser {
    id: string;
    email: string;
  }

  const createUser = async (): Promise<TestUser> => {
    const email = uniqueEmail();

    const user = await users.create({
      name: 'BLG-04 Test User',
      email,
      passwordHash,
      role: Role.User,
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
      .send({
        email: user.email,
        password: PASSWORD,
      });

    expect(response.status).toBe(200);

    const cookieHeader = response.headers['set-cookie'];

    expect(cookieHeader).toBeDefined();

    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];

    const accessCookie = cookies
      .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`))
      ?.split(';')[0];

    expect(accessCookie).toBeDefined();

    return accessCookie!;
  };

  const createPost = async (
    user: TestUser,
    cookie: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Cookie', cookie)
      .send({
        title: 'Original title',
        body: 'Original body',
        ...overrides,
      });

    expect(response.status).toBe(201);
    expect(response.body.authorId).toBe(user.id);

    const id = response.body.id as string;
    createdPostIds.push(id);

    return id;
  };

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
    likes = app.get<Model<Like>>(getModelToken(Like.name));
  });

  afterAll(async () => {
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }

    for (const id of createdCommentIds) {
      await comments.findByIdAndDelete(id);
    }

    for (const id of createdLikeIds) {
      await likes.findByIdAndDelete(id);
    }

    // The logins made sessions (ACC-06): delete them first.
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }

    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }

    await app.close();
  });

  it('allows the owner to edit title and body and returns only the mapped DTO', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    const postId = await createPost(user, cookie);

    const response = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', cookie)
      .send({
        title: 'Updated title',
        body: 'Updated body',
      });

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      id: postId,
      authorId: user.id,
      title: 'Updated title',
      body: 'Updated body',
      status: PostStatus.Draft,
      tags: [],
      images: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    expect(response.body._id).toBeUndefined();
    expect(response.body.passwordHash).toBeUndefined();
    expect(response.body.author).toBeUndefined();
  });

  it('sets publishedAt when publishing a draft, keeps it when editing a published post, and clears it when returning to draft', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    const postId = await createPost(user, cookie);

    const publishResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', cookie)
      .send({
        status: PostStatus.Published,
      });

    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.status).toBe(PostStatus.Published);
    expect(publishResponse.body.publishedAt).toEqual(expect.any(String));

    const originalPublishedAt = publishResponse.body.publishedAt;

    const editPublishedResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', cookie)
      .send({
        title: 'Updated published title',
      });

    expect(editPublishedResponse.status).toBe(200);
    expect(editPublishedResponse.body.status).toBe(PostStatus.Published);
    expect(editPublishedResponse.body.publishedAt).toBe(originalPublishedAt);

    const draftResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', cookie)
      .send({
        status: PostStatus.Draft,
      });

    expect(draftResponse.status).toBe(200);
    expect(draftResponse.body.status).toBe(PostStatus.Draft);
    expect(draftResponse.body.publishedAt).toBeUndefined();
  });

  it('rejects another user from editing or deleting the post and changes nothing', async () => {
    const owner = await createUser();
    const otherUser = await createUser();

    const ownerCookie = await loginAs(owner);
    const otherCookie = await loginAs(otherUser);

    const postId = await createPost(owner, ownerCookie);

    const before = await posts.findById(postId).lean();

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', otherCookie)
      .send({
        title: 'Should not change',
        body: 'Should not change',
      });

    expect(patchResponse.status).toBe(403);

    const afterPatch = await posts.findById(postId).lean();
    expect(afterPatch?.title).toBe(before?.title);
    expect(afterPatch?.body).toBe(before?.body);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/posts/${postId}`)
      .set('Cookie', otherCookie);

    expect(deleteResponse.status).toBe(403);

    const afterDelete = await posts.findById(postId).lean();
    expect(afterDelete).not.toBeNull();
  });

  it('returns 404 for an unknown valid id on both routes', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const unknownId = '507f1f77bcf86cd799439011';

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${unknownId}`)
      .set('Cookie', cookie)
      .send({
        title: 'Does not exist',
      });

    expect(patchResponse.status).toBe(404);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/posts/${unknownId}`)
      .set('Cookie', cookie);

    expect(deleteResponse.status).toBe(404);
  });

  it('returns 400 for malformed ids on both routes', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const malformedId = 'not-a-valid-object-id';

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${malformedId}`)
      .set('Cookie', cookie)
      .send({
        title: 'Invalid id',
      });

    expect(patchResponse.status).toBe(400);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/posts/${malformedId}`)
      .set('Cookie', cookie);

    expect(deleteResponse.status).toBe(400);
  });

  it('returns 401 with the required message when the guest edits or deletes', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    const postId = await createPost(user, cookie);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .send({
        title: 'Guest edit',
      });

    expect(patchResponse.status).toBe(401);
    expect(patchResponse.body.message).toBe('You must log in to do this');

    const deleteResponse = await request(app.getHttpServer()).delete(
      `/api/posts/${postId}`,
    );

    expect(deleteResponse.status).toBe(401);
    expect(deleteResponse.body.message).toBe('You must log in to do this');
  });

  // Tags became editable with BLG-08 (test/blog-tags.e2e-spec.ts). Images
  // still have their own routes (BLG-10), so they stay refused here.
  it('rejects images and unknown fields in the PATCH body', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    const postId = await createPost(user, cookie);

    const imagesResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', cookie)
      .send({
        images: ['photo.png'],
      });

    expect(imagesResponse.status).toBe(400);

    const unknownFieldResponse = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', cookie)
      .send({
        unknownField: 'not allowed',
      });

    expect(unknownFieldResponse.status).toBe(400);
  });

  it('treats an empty PATCH body as a no-op', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    const postId = await createPost(user, cookie);

    const before = await posts.findById(postId).lean();

    const response = await request(app.getHttpServer())
      .patch(`/api/posts/${postId}`)
      .set('Cookie', cookie)
      .send({});

    expect(response.status).toBe(200);

    const after = await posts.findById(postId).lean();

    expect(after?.title).toBe(before?.title);
    expect(after?.body).toBe(before?.body);
    expect(after?.status).toBe(before?.status);
    expect(after?.publishedAt).toEqual(before?.publishedAt);
  });

  it('allows the owner to delete the post', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    const postId = await createPost(user, cookie);

    const response = await request(app.getHttpServer())
      .delete(`/api/posts/${postId}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(204);

    const deletedPost = await posts.findById(postId);
    expect(deletedPost).toBeNull();

    const getResponse = await request(app.getHttpServer()).get(
      `/api/posts/${postId}`,
    );

    expect(getResponse.status).toBe(404);

    createdPostIds.splice(createdPostIds.indexOf(postId), 1);
  });

  it('deletes the post and its associated comment and like', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    const postId = await createPost(user, cookie);

    const comment = await comments.create({
      postId,
      authorId: user.id,
      body: 'BLG-04 test comment',
    });

    const like = await likes.create({
      postId,
      userId: user.id,
    });

    const commentId = comment._id.toString();
    const likeId = like._id.toString();

    createdCommentIds.push(commentId);
    createdLikeIds.push(likeId);

    const response = await request(app.getHttpServer())
      .delete(`/api/posts/${postId}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(204);

    expect(await posts.findById(postId)).toBeNull();
    expect(await comments.findById(commentId)).toBeNull();
    expect(await likes.findById(likeId)).toBeNull();

    createdPostIds.splice(createdPostIds.indexOf(postId), 1);
    createdCommentIds.splice(createdCommentIds.indexOf(commentId), 1);
    createdLikeIds.splice(createdLikeIds.indexOf(likeId), 1);
  });
});
