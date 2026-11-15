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
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const ROUTE = '/api/posts/mine';

/** The value of one cookie in the `Set-Cookie` lines of a response, or undefined. */
function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const header = response.headers['set-cookie'];
  const lines = Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
  const line = lines.find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

interface Row {
  id: string;
  title: string;
  status: string;
  likeCount: number;
  commentCount: number;
  publishedAt?: string;
  createdAt: string;
}

describe('GET /api/posts/mine (e2e, BLG-03)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];

  /** The cookies of the accounts below, by name. */
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

  const list = (who: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(ROUTE)
      .query(query)
      .set('Cookie', cookies.get(who) ?? '');

  const titles = (body: { items: Row[] }) => body.items.map((row) => row.title);

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

    // One insertMany for the accounts and one for the posts: single creates in
    // a row have stalled against the Atlas test database (ACC-14, BLG-01).
    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role][] = [
      ['author', Role.User],
      ['other', Role.User],
      ['empty', Role.User],
      ['moderator', Role.HotelModerator],
    ];
    const insertedUsers = await users.insertMany(
      accounts.map(([label, role]) => ({
        name: `BLG-03 ${label}`,
        email: `blg03-${label}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
      })),
    );
    for (const [index, user] of insertedUsers.entries()) {
      const label = accounts[index][0];
      createdUserIds.push(user._id.toString());
      ids.set(label, user._id.toString());
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD });
      expect(login.status).toBe(200);
      cookies.set(
        label,
        `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
      );
    }

    // The author's three posts, one minute apart, and one post of someone else.
    const start = Date.now() - 60 * 60_000;
    const at = (minute: number) => new Date(start + minute * 60_000);
    const author = new Types.ObjectId(ids.get('author'));
    const insertedPosts = await posts.insertMany([
      {
        authorId: author,
        title: 'Oldest published',
        body: 'Body',
        status: PostStatus.Published,
        publishedAt: at(1),
        likeCount: 4,
        commentCount: 2,
        createdAt: at(1),
      },
      {
        authorId: author,
        title: 'Middle draft',
        body: 'Body',
        status: PostStatus.Draft,
        createdAt: at(2),
      },
      {
        authorId: author,
        title: 'Newest draft',
        body: 'Body',
        status: PostStatus.Draft,
        createdAt: at(3),
      },
      {
        authorId: new Types.ObjectId(ids.get('other')),
        title: 'Not mine',
        body: 'Body',
        status: PostStatus.Draft,
        createdAt: at(4),
      },
    ]);
    createdPostIds.push(...insertedPosts.map((post) => post._id.toString()));
  });

  afterAll(async () => {
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('the list', () => {
    it('lists only my posts, drafts included, newest first', async () => {
      const response = await list('author');

      expect(response.status).toBe(200);
      expect(titles(response.body)).toEqual([
        'Newest draft',
        'Middle draft',
        'Oldest published',
      ]);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('shows the title, status, dates and the like and comment counts, and nothing else', async () => {
      const response = await list('author');

      const published = (response.body.items as Row[]).find(
        (row) => row.title === 'Oldest published',
      );
      expect(published).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        title: 'Oldest published',
        status: 'published',
        publishedAt: expect.stringMatching(/Z$/),
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/),
        likeCount: 4,
        commentCount: 2,
      });
      const draft = (response.body.items as Row[]).find(
        (row) => row.title === 'Newest draft',
      );
      expect(draft).not.toHaveProperty('publishedAt');
      expect(draft).toMatchObject({ likeCount: 0, commentCount: 0 });
    });

    it('never shows the posts of another user', async () => {
      const response = await list('other');

      expect(titles(response.body)).toEqual(['Not mine']);
    });

    it('pages through my posts', async () => {
      const response = await list('author', { page: '2', limit: '2' });

      expect(titles(response.body)).toEqual(['Oldest published']);
      expect(response.body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('answers an empty page for a user with no posts', async () => {
      const response = await list('empty');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('shows a post made with POST /api/posts, with counts of 0', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/posts')
        .set('Cookie', cookies.get('empty') ?? '')
        .send({ title: 'Made through the API', body: 'Body' });
      expect(created.status).toBe(201);
      createdPostIds.push(created.body.id as string);

      const response = await list('empty');

      expect(response.body.items).toEqual([
        expect.objectContaining({
          id: created.body.id,
          title: 'Made through the API',
          status: 'draft',
          likeCount: 0,
          commentCount: 0,
        }),
      ]);
    });
  });

  describe('a refused list', () => {
    it('answers 400 for a page size over 50', async () => {
      expect((await list('author', { limit: '51' })).status).toBe(400);
    });

    it('answers 400 for a parameter that is not allowed', async () => {
      expect((await list('author', { status: 'draft' })).status).toBe(400);
    });

    it('is closed to a moderator', async () => {
      expect((await list('moderator')).status).toBe(403);
    });

    it('needs a login', async () => {
      const response = await request(app.getHttpServer()).get(ROUTE);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents the route, its page parameters and its answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route = response.body.paths[ROUTE].get;
      const parameters = (route.parameters as { name: string }[]).map(
        (parameter) => parameter.name,
      );
      expect(parameters).toEqual(expect.arrayContaining(['page', 'limit']));
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
    });
  });
});
