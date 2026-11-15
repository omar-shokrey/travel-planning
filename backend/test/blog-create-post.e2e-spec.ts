import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import './support/auth-env';

import { AppModule } from './../src/app.module';
import { deleteSessionsOf } from './support/delete-sessions';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import {
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from './../src/blog/dto/create-post.dto';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';

const uniqueEmail = (): string => `blg01-${randomUUID()}@example.com`;

describe('POST /api/posts (e2e, BLG-01)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let passwordHash: string;

  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];

  interface TestUser {
    id: string;
    email: string;
  }

  const createUser = async (
    fields: { role?: Role; status?: UserStatus } = {},
  ): Promise<TestUser> => {
    const email = uniqueEmail();

    const user = await users.create({
      name: 'BLG-01 Test User',
      email,
      passwordHash,
      role: fields.role ?? Role.User,
      status: fields.status ?? UserStatus.Active,
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

  const createPost = (body: Record<string, unknown>, cookie?: string) => {
    const call = request(app.getHttpServer()).post('/api/posts').send(body);

    return cookie ? call.set('Cookie', cookie) : call;
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
  });

  afterAll(async () => {
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }

    // The logins made sessions (ACC-06): delete them, one by one, first.
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }

    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }

    await app.close();
  });

  it('creates a draft post for a logged-in registered user', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
      },
      cookie,
    );

    expect(response.status).toBe(201);

    expect(response.body).toMatchObject({
      authorId: user.id,
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Draft,
      tags: [],
      images: [],
    });

    expect(response.body.publishedAt).toBeUndefined();
    expect(response.body.createdAt).toEqual(expect.any(String));
    expect(response.body.updatedAt).toEqual(expect.any(String));

    createdPostIds.push(response.body.id);
  });

  it('creates a published post with tags and sets publishedAt', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Best places in Cairo',
        body: 'Here are some of my favorite places in Cairo.',
        status: PostStatus.Published,
        tags: [' Cairo ', 'EGYPT', 'cairo'],
      },
      cookie,
    );

    expect(response.status).toBe(201);

    expect(response.body).toMatchObject({
      authorId: user.id,
      title: 'Best places in Cairo',
      body: 'Here are some of my favorite places in Cairo.',
      status: PostStatus.Published,
      tags: ['cairo', 'egypt'],
      images: [],
    });

    expect(response.body.publishedAt).toEqual(expect.any(String));
    expect(response.body.createdAt).toEqual(expect.any(String));
    expect(response.body.updatedAt).toEqual(expect.any(String));

    createdPostIds.push(response.body.id);
  });

  it('rejects a request without login', async () => {
    const response = await createPost({
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
    });

    expect(response.status).toBe(401);
  });

  it('rejects a missing title or body', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const missingTitle = await createPost(
      {
        body: 'I spent three amazing days exploring Cairo.',
      },
      cookie,
    );

    const missingBody = await createPost(
      {
        title: 'Three days in Cairo',
      },
      cookie,
    );

    expect(missingTitle.status).toBe(400);
    expect(missingBody.status).toBe(400);
  });

  it('rejects a blank title', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: '   ',
        body: 'I spent three amazing days exploring Cairo.',
      },
      cookie,
    );

    expect(response.status).toBe(400);
  });

  it('rejects more than five tags', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
        tags: ['one', 'two', 'three', 'four', 'five', 'six'],
      },
      cookie,
    );

    expect(response.status).toBe(400);
  });

  it('rejects a tag longer than 30 characters', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
        tags: ['a'.repeat(31)],
      },
      cookie,
    );

    expect(response.status).toBe(400);
  });

  it('rejects a client-supplied authorId', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
        authorId: '507f1f77bcf86cd799439011',
      },
      cookie,
    );

    expect(response.status).toBe(400);
  });

  it('rejects an invalid status', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
        status: 'invalid-status',
      },
      cookie,
    );

    expect(response.status).toBe(400);
  });

  it('rejects unknown fields', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
        unknownField: 'not allowed',
      },
      cookie,
    );

    expect(response.status).toBe(400);
  });

  it('uses the authenticated user as authorId', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      {
        title: 'Authenticated author',
        body: 'The authenticated user should own this post.',
      },
      cookie,
    );

    expect(response.status).toBe(201);
    expect(response.body.authorId).toBe(user.id);

    createdPostIds.push(response.body.id);
  });

  it('returns every moment as a UTC ISO string', async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(
      { title: 'Dates', body: 'Body', status: 'published' },
      cookie,
    );

    expect(response.status).toBe(201);
    createdPostIds.push(response.body.id as string);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(response.body.createdAt).toMatch(iso);
    expect(response.body.updatedAt).toMatch(iso);
    expect(response.body.publishedAt).toMatch(iso);
  });

  it.each([
    [
      'a title',
      { title: 'a'.repeat(POST_TITLE_MAX_LENGTH + 1), body: 'Body' },
      'title',
    ],
    [
      'a body',
      { title: 'Title', body: 'b'.repeat(POST_BODY_MAX_LENGTH + 1) },
      'body',
    ],
  ])('rejects %s longer than the limit', async (_name, body, field) => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await createPost(body, cookie);

    expect(response.status).toBe(400);
    expect(
      (response.body.errors as { field: string }[]).map((error) => error.field),
    ).toEqual([field]);
  });

  describe('roles that do not write posts', () => {
    const roles = [Role.AirlineModerator, Role.HotelModerator, Role.Admin];
    const accounts = new Map<Role, { id: string; cookie: string }>();

    beforeAll(async () => {
      // One insertMany for the three accounts: single creates in a row have
      // stalled against the Atlas test database (see the ACC-14 e2e test).
      const inserted = await users.insertMany(
        roles.map((role) => ({
          name: 'BLG-01 Test User',
          email: uniqueEmail(),
          passwordHash,
          role,
          status: UserStatus.Active,
          consentAcceptedAt: new Date(),
        })),
      );
      for (const user of inserted) {
        const id = user._id.toString();
        createdUserIds.push(id);
        accounts.set(user.role, {
          id,
          cookie: await loginAs({ id, email: user.email }),
        });
      }
    });

    it.each(roles)(
      'refuses a %s, because only registered users write posts',
      async (role) => {
        const account = accounts.get(role);
        expect(account).toBeDefined();

        const response = await createPost(
          { title: 'Not allowed', body: 'Body' },
          account?.cookie,
        );

        expect(response.status).toBe(403);
        expect(await posts.countDocuments({ authorId: account?.id })).toBe(0);
      },
    );
  });
});
