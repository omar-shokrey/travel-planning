import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { DELETED_USER_NAME } from './../src/blog/blog.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

/** A tag no real post has, so the tag page shows only the posts of this run. */
const TAG = `blg08-${randomUUID().slice(0, 8)}`;
const OTHER_TAG = `blg08-${randomUUID().slice(0, 8)}`;

interface Actor {
  id: string;
  cookie: string;
}

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

describe('Post tags (e2e, BLG-08)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  /** What these tests created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];

  let author: Actor;
  let otherUser: Actor;
  let admin: Actor;

  const http = () => request(app.getHttpServer());

  const createActor = async (
    role: Role,
    name = 'Tag Test Author',
    status = UserStatus.Active,
  ): Promise<Actor> => {
    const user = await users.create({
      name,
      email: `blg08-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      status,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    return {
      id,
      cookie:
        status === UserStatus.Active ? await sessionCookieFor(app, id) : '',
    };
  };

  /** A post written straight to the database, so the test controls every field. */
  const createPost = async (
    authorId: string,
    fields: Partial<BlogPost> = {},
  ): Promise<string> => {
    const post = await posts.create({
      authorId: new Types.ObjectId(authorId),
      title: 'A tagged post',
      body: 'Body of a tagged post',
      status: PostStatus.Published,
      publishedAt: new Date(),
      tags: [TAG],
      ...fields,
    });
    const id = post._id.toString();
    createdPostIds.push(id);
    return id;
  };

  const patch = (id: string, body: unknown, cookie?: string) => {
    const call = http().patch(`/api/posts/${id}`);
    return (cookie ? call.set('Cookie', cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  const storedTags = async (id: string) =>
    (await posts.findById(id).lean().orFail()).tags;

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

    author = await createActor(Role.User, 'Sara Tagger');
    otherUser = await createActor(Role.User);
    admin = await createActor(Role.Admin);
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
  });

  describe('PATCH /api/posts/:id edits the tags', () => {
    it('replaces the tags, normalised as at creation', async () => {
      const id = await createPost(author.id, { tags: ['old'] });

      const response = await patch(
        id,
        { tags: ['  Cairo ', 'EGYPT', 'cairo', '', 'nile'] },
        author.cookie,
      );

      expect(response.status).toBe(200);
      expect(response.body.tags).toEqual(['cairo', 'egypt', 'nile']);
      expect(await storedTags(id)).toEqual(['cairo', 'egypt', 'nile']);
    });

    it('clears the tags with an empty list', async () => {
      const id = await createPost(author.id, { tags: ['a', 'b'] });

      const response = await patch(id, { tags: [] }, author.cookie);

      expect(response.status).toBe(200);
      expect(await storedTags(id)).toEqual([]);
    });

    it('leaves the tags alone when they are not sent', async () => {
      const id = await createPost(author.id, { tags: ['keep'] });

      const response = await patch(id, { title: 'New title' }, author.cookie);

      expect(response.status).toBe(200);
      expect(await storedTags(id)).toEqual(['keep']);
    });

    it.each([
      ['six tags', { tags: ['a', 'b', 'c', 'd', 'e', 'f'] }],
      ['a tag of 31 characters', { tags: ['x'.repeat(31)] }],
      ['tags sent as null', { tags: null }],
      ['a tag that is not text', { tags: [5] }],
      ['tags that are not a list', { tags: 'cairo' }],
    ])('refuses %s with 400 and keeps the tags', async (_label, body) => {
      const id = await createPost(author.id, { tags: ['keep'] });

      const response = await patch(id, body, author.cookie);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'tags', messages: expect.any(Array) },
      ]);
      expect(await storedTags(id)).toEqual(['keep']);
    });

    it('accepts five tags of 30 characters', async () => {
      const id = await createPost(author.id);
      const tags = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(30));

      const response = await patch(id, { tags }, author.cookie);

      expect(response.status).toBe(200);
      expect(response.body.tags).toEqual(tags);
    });

    it('refuses another user with 403 and a guest with 401, and keeps the tags', async () => {
      const id = await createPost(author.id, { tags: ['keep'] });

      const other = await patch(id, { tags: ['taken'] }, otherUser.cookie);
      const guest = await patch(id, { tags: ['taken'] });

      expect(other.status).toBe(403);
      expect(guest.status).toBe(401);
      expect(guest.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(await storedTags(id)).toEqual(['keep']);
    });

    it('answers 404 for a post that does not exist and 400 for a malformed id', async () => {
      const missing = await patch(
        new Types.ObjectId().toString(),
        { tags: [] },
        author.cookie,
      );
      const malformed = await patch('not-an-id', { tags: [] }, author.cookie);

      expect(missing.status).toBe(404);
      expect(malformed.status).toBe(400);
    });
  });

  describe('GET /api/tags/:tag/posts', () => {
    let newest: string;
    let middle: string;
    let oldest: string;
    let draft: string;
    let otherTag: string;
    let goneAuthorPost: string;

    beforeAll(async () => {
      const gone = await createActor(
        Role.User,
        'Gone Author',
        UserStatus.Deactivated,
      );
      const day = (offset: number) =>
        new Date(Date.UTC(2026, 10, 10 + offset, 9, 0, 0));
      oldest = await createPost(author.id, {
        title: 'Oldest',
        publishedAt: day(0),
        body: `${'word '.repeat(60)}end`,
        tags: [TAG, 'nile'],
        likeCount: 3,
        commentCount: 1,
      });
      middle = await createPost(author.id, {
        title: 'Middle',
        publishedAt: day(1),
      });
      newest = await createPost(author.id, {
        title: 'Newest',
        publishedAt: day(2),
      });
      goneAuthorPost = await createPost(gone.id, {
        title: 'By a deactivated author',
        publishedAt: day(-1),
      });
      draft = await createPost(author.id, {
        title: 'Draft',
        status: PostStatus.Draft,
        publishedAt: undefined,
      });
      otherTag = await createPost(author.id, {
        title: 'Other tag',
        tags: [OTHER_TAG],
      });
    });

    const list = (tag: string, query = '') =>
      http().get(`/api/tags/${encodeURIComponent(tag)}/posts${query}`);

    it('is open to guests and lists only the published posts of the tag, newest first', async () => {
      const response = await list(TAG);

      expect(response.status).toBe(200);
      const ids = (response.body.items as SummaryRow[]).map((row) => row.id);
      expect(ids).toEqual([newest, middle, oldest, goneAuthorPost]);
      expect(ids).not.toContain(draft);
      expect(ids).not.toContain(otherTag);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 4,
        totalPages: 1,
      });
    });

    it('reads the tag like a saved tag: case and outer spaces are ignored', async () => {
      const response = await list(`  ${TAG.toUpperCase()} `);

      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(4);
    });

    it('pages the list', async () => {
      const response = await list(TAG, '?page=2&limit=2');

      expect(response.status).toBe(200);
      expect(
        (response.body.items as SummaryRow[]).map((row) => row.id),
      ).toEqual([oldest, goneAuthorPost]);
      expect(response.body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 4,
        totalPages: 2,
      });
    });

    it('returns rows with public fields only, the author name and an excerpt', async () => {
      const response = await list(TAG);
      const rows = response.body.items as SummaryRow[];
      const row = rows.find((item) => item.id === oldest);

      expect(row).toEqual({
        id: oldest,
        title: 'Oldest',
        author: { id: author.id, name: 'Sara Tagger' },
        publishedAt: '2026-11-10T09:00:00.000Z',
        excerpt: expect.stringMatching(/word…$/),
        tags: [TAG, 'nile'],
        likeCount: 3,
        commentCount: 1,
      });
      for (const item of rows) {
        expect(Object.keys(item).sort()).toEqual([
          'author',
          'commentCount',
          'excerpt',
          'id',
          'likeCount',
          'publishedAt',
          'tags',
          'title',
        ]);
      }
    });

    it('shows "Deleted user" for a deactivated author', async () => {
      const response = await list(TAG);
      const row = (response.body.items as SummaryRow[]).find(
        (item) => item.id === goneAuthorPost,
      );

      expect(row?.author.name).toBe(DELETED_USER_NAME);
    });

    it('answers an empty page for a tag nobody uses', async () => {
      const response = await list(`unused-${randomUUID().slice(0, 8)}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it.each([
      ['a tag of 31 characters', 'x'.repeat(31), ''],
      ['a tag of spaces only', '   ', ''],
      ['a page size above 50', TAG, '?limit=51'],
      ['an unknown parameter', TAG, '?sort=likes'],
    ])('refuses %s with 400', async (_label, tag, query) => {
      const response = await list(tag, query);

      expect(response.status).toBe(400);
    });

    it('lists the same for a logged-in user and for an admin', async () => {
      const guest = await list(TAG);
      const asAdmin = await list(TAG).set('Cookie', admin.cookie);

      expect(asAdmin.status).toBe(200);
      expect(asAdmin.body).toEqual(guest.body);
    });
  });

  it('documents both routes in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths;
    const tagPage = paths['/api/tags/{tag}/posts'].get as {
      security?: unknown;
      responses: Record<string, unknown>;
    };

    expect(tagPage.security).toBeUndefined();
    expect(Object.keys(tagPage.responses)).toEqual(
      expect.arrayContaining(['200', '400']),
    );
    expect(
      Object.keys(
        response.body.components.schemas.UpdatePostDto.properties as object,
      ),
    ).toContain('tags');
    expect(
      Object.keys(
        response.body.components.schemas.PostSummaryResponseDto
          .properties as object,
      ).sort(),
    ).toEqual([
      'author',
      'commentCount',
      'excerpt',
      'id',
      'likeCount',
      'publishedAt',
      'tags',
      'title',
    ]);
  });
});
