import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { Role } from './../src/common/enums/role.enum';
import { User } from './../src/users/models/user.schema';

/** A word no real post or user has, so a search finds only what this run made. */
const word = (prefix: string): string =>
  `${prefix}${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const KEYWORD = word('blg09k');
/** Own words for the other blocks, so no block's posts match another block's search. */
const REGEX_WORD = word('blg09r');
const ORDER_WORD = word('blg09o');
const MODERATOR_WORD = word('blg09m');

interface SummaryRow {
  id: string;
  title: string;
  author: { id: string; name: string };
  publishedAt: string;
  excerpt: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
}

describe('Search published posts (e2e, BLG-09)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  /** What these tests created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];

  let author: string;
  let namedAuthor: string;

  const http = () => request(app.getHttpServer());
  const search = (query: Record<string, string>) =>
    http().get('/api/posts').query(query);
  const idsOf = (response: request.Response) =>
    (response.body.items as SummaryRow[]).map((row) => row.id);

  const createUser = async (name: string, role = Role.User) => {
    const user = await users.create({
      name,
      email: `blg09-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    return id;
  };

  /** A post written straight to the database, so the test controls the counters and the dates. */
  const createPost = async (
    fields: Omit<Partial<BlogPost>, 'authorId'> & { authorId?: string },
  ) => {
    const { authorId, ...rest } = fields;
    const post = await posts.create({
      authorId: new Types.ObjectId(authorId ?? author),
      title: 'Untitled',
      body: 'Body of a search test post',
      status: PostStatus.Published,
      publishedAt: new Date('2026-11-01T10:00:00.000Z'),
      ...rest,
    });
    const id = post._id.toString();
    createdPostIds.push(id);
    return id;
  };

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

    author = await createUser('Search Test Author');
    namedAuthor = await createUser(`Writer ${KEYWORD} Nour`);
  });

  afterAll(async () => {
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('what matches', () => {
    let byTitle: string;
    let byTag: string;
    let byAuthor: string;
    let draft: string;
    let unrelated: string;

    beforeAll(async () => {
      byTitle = await createPost({ title: `A trip to ${KEYWORD} land` });
      byTag = await createPost({
        title: 'Tagged post',
        tags: [`${KEYWORD}tag`],
      });
      byAuthor = await createPost({
        title: 'Post by a matching author',
        authorId: namedAuthor,
      });
      draft = await createPost({
        title: `Draft about ${KEYWORD}`,
        status: PostStatus.Draft,
        publishedAt: undefined,
      });
      unrelated = await createPost({ title: 'Nothing to see here' });
    });

    it('is open to guests and matches the title, the tags and the author name', async () => {
      const response = await search({ q: KEYWORD });

      expect(response.status).toBe(200);
      expect(idsOf(response).sort()).toEqual([byTitle, byTag, byAuthor].sort());
      expect(response.body.meta.total).toBe(3);
    });

    it('never shows a draft or a post that does not match', async () => {
      const ids = idsOf(await search({ q: KEYWORD }));

      expect(ids).not.toContain(draft);
      expect(ids).not.toContain(unrelated);
    });

    it('ignores letter case and matches part of a word', async () => {
      const upper = await search({ q: KEYWORD.toUpperCase() });
      const part = await search({ q: KEYWORD.slice(2, -2) });

      expect(idsOf(upper).sort()).toEqual([byTitle, byTag, byAuthor].sort());
      expect(idsOf(part)).toEqual(
        expect.arrayContaining([byTitle, byTag, byAuthor]),
      );
    });

    it('finds the posts of an author by the author name only, not other authors', async () => {
      const response = await search({ q: `${KEYWORD} Nour` });

      expect(idsOf(response)).toEqual([byAuthor]);
      expect((response.body.items as SummaryRow[])[0].author).toEqual({
        id: namedAuthor,
        name: `Writer ${KEYWORD} Nour`,
      });
    });

    it('returns rows with the title, author, date and excerpt, and no internal field', async () => {
      const rows = (await search({ q: KEYWORD })).body.items as SummaryRow[];

      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          'author',
          'commentCount',
          'excerpt',
          'id',
          'likeCount',
          'publishedAt',
          'tags',
          'title',
        ]);
        expect(row.publishedAt).toBe('2026-11-01T10:00:00.000Z');
        expect(row.excerpt).toBe('Body of a search test post');
      }
    });
  });

  describe('regex characters', () => {
    it('treats them as plain text: they cannot fail or match everything', async () => {
      const literal = await createPost({ title: `${REGEX_WORD}.*( literal` });
      const lookalike = await createPost({
        title: `${REGEX_WORD}xx( lookalike`,
      });

      const specials = await search({ q: `${REGEX_WORD}.*(` });
      const onlySpecials = await search({ q: '.*(' });

      expect(specials.status).toBe(200);
      expect(idsOf(specials)).toEqual([literal]);
      expect(idsOf(specials)).not.toContain(lookalike);
      expect(onlySpecials.status).toBe(200);
      for (const row of onlySpecials.body.items as SummaryRow[]) {
        expect(
          row.title.includes('.*(') ||
            row.tags.some((tag) => tag.includes('.*(')) ||
            row.author.name.includes('.*('),
        ).toBe(true);
      }
    });
  });

  describe('order', () => {
    let top: string;
    let tieNewer: string;
    let tieOlder: string;
    let bottom: string;

    beforeAll(async () => {
      tieOlder = await createPost({
        title: `${ORDER_WORD} tie older`,
        likeCount: 5,
        commentCount: 0,
        publishedAt: new Date('2026-11-02T10:00:00.000Z'),
      });
      bottom = await createPost({
        title: `${ORDER_WORD} bottom`,
        likeCount: 0,
        commentCount: 0,
        publishedAt: new Date('2026-11-09T10:00:00.000Z'),
      });
      top = await createPost({
        title: `${ORDER_WORD} top`,
        likeCount: 3,
        commentCount: 7,
        publishedAt: new Date('2026-11-01T10:00:00.000Z'),
      });
      tieNewer = await createPost({
        title: `${ORDER_WORD} tie newer`,
        likeCount: 1,
        commentCount: 4,
        publishedAt: new Date('2026-11-05T10:00:00.000Z'),
      });
    });

    it('orders by likes plus comments, newest first on a tie', async () => {
      const response = await search({ q: ORDER_WORD });

      expect(idsOf(response)).toEqual([top, tieNewer, tieOlder, bottom]);
    });

    it('pages the ordered results and counts all of them', async () => {
      const first = await search({ q: ORDER_WORD, page: '1', limit: '3' });
      const second = await search({ q: ORDER_WORD, page: '2', limit: '3' });

      expect(idsOf(first)).toEqual([top, tieNewer, tieOlder]);
      expect(idsOf(second)).toEqual([bottom]);
      expect(second.body.meta).toEqual({
        page: 2,
        limit: 3,
        total: 4,
        totalPages: 2,
      });
    });
  });

  it('does not match the name of an account that is not a registered user', async () => {
    const moderator = await createUser(
      `Moderator ${MODERATOR_WORD}`,
      Role.AirlineModerator,
    );
    await createPost({ title: 'Written by a moderator', authorId: moderator });

    const response = await search({ q: MODERATOR_WORD });

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(0);
  });

  it('answers an empty page when nothing matches ("no results")', async () => {
    const response = await search({ q: `${KEYWORD}nothing` });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('lists the newest published posts without a keyword', async () => {
    // Dates far ahead and later on every run, so these two are the newest
    // posts in the test database, even next to a leftover of a stopped run.
    const base = Date.UTC(2099, 0, 1) + Date.now();
    const later = await createPost({
      title: 'Feed later',
      publishedAt: new Date(base + 1_000),
    });
    const earlier = await createPost({
      title: 'Feed earlier',
      publishedAt: new Date(base),
    });

    const response = await http().get('/api/posts').query({ limit: '2' });

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual([later, earlier]);
    expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['an empty keyword', { q: '' }],
    ['a keyword of spaces only', { q: '   ' }],
    ['a keyword over 100 characters', { q: 'a'.repeat(101) }],
    ['a page size above 50', { limit: '51' }],
    ['an unknown parameter', { sort: 'likes' }],
    // MongoDB refuses a pattern with a null byte: it must be a 400, never a 500.
    ['a keyword with a null byte', { q: 'a\u0000b' }],
  ])('refuses %s with 400', async (_label, query) => {
    const response = await search(query);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  it('keeps GET /api/posts/mine for its own route', async () => {
    const response = await http().get('/api/posts/mine');

    expect(response.status).toBe(401);
  });

  it('documents the route in Swagger as public, with its query and answers', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/posts'].get as {
      security?: unknown;
      parameters: { name: string }[];
      responses: Record<string, unknown>;
    };

    expect(operation.security).toBeUndefined();
    expect(operation.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(['q', 'page', 'limit']),
    );
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400']),
    );
  });
});
