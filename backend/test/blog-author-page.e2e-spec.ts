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
import { PostModeration } from './../src/blog/models/post-moderation.enum';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { ItineraryModeration } from './../src/itineraries/enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './../src/itineraries/enums/itinerary-visibility.enum';
import { Itinerary } from './../src/itineraries/models/itinerary.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = randomUUID().slice(0, 8);

interface ListBody {
  items: { id: string }[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface PageBody {
  id: string;
  name: string;
  joinedAt: string;
  posts: ListBody;
  itineraries: ListBody;
}

/** A schema of the Swagger document: only the parts these tests read. */
interface SwaggerSchema {
  $ref?: string;
  allOf?: SwaggerSchema[];
  type?: string;
  items?: SwaggerSchema;
  properties?: Record<string, SwaggerSchema>;
}

interface SwaggerOperation {
  security?: unknown[];
  responses: Record<
    string,
    { content?: { 'application/json': { schema: SwaggerSchema } } }
  >;
}

describe('Public author page (e2e, BLG-12)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let itineraries: Model<Itinerary>;

  /** What these tests created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];
  const createdItineraryIds: string[] = [];

  let author: string;
  let authorCookie: string;
  let readerCookie: string;
  let otherAuthor: string;
  let suspended: string;
  let admin: string;
  let moderator: string;
  let deactivated: string;

  let olderPost: string;
  let newerPost: string;
  let draftPost: string;
  let hiddenPost: string;
  let otherAuthorsPost: string;

  let olderTrip: string;
  let newerTrip: string;
  let privateTrip: string;
  let hiddenTrip: string;
  let otherAuthorsTrip: string;

  const http = () => request(app.getHttpServer());
  const page = (
    id: string,
    query: Record<string, string> = {},
    cookie?: string,
  ) => {
    const call = http().get(`/api/authors/${id}`).query(query);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const pageBody = async (id: string, query: Record<string, string> = {}) =>
    (await page(id, query).expect(200)).body as PageBody;
  const ids = (list: ListBody) => list.items.map((item) => item.id);

  const createUsers = async (
    accounts: { label: string; role: Role; status?: UserStatus }[],
  ): Promise<string[]> => {
    const created = await users.insertMany(
      accounts.map(({ label, role, status }) => ({
        name: `BLG-12 ${label} ${RUN}`,
        email: `blg12-${label}-${randomUUID()}@example.com`,
        passwordHash: 'not-a-real-hash',
        phone: '+201000000000',
        role,
        status: status ?? UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...(role === Role.HotelModerator && {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: new Types.ObjectId(),
          },
        }),
      })),
    );
    const userIds = created.map((user) => user._id.toString());
    createdUserIds.push(...userIds);
    return userIds;
  };

  /** Posts written straight to the database, so the test controls every field. */
  const createPosts = async (
    rows: { authorId: string; fields?: Partial<BlogPost> }[],
  ): Promise<string[]> => {
    const created = await posts.insertMany(
      rows.map(({ authorId, fields }) => ({
        authorId: new Types.ObjectId(authorId),
        title: `BLG-12 post ${RUN}`,
        body: 'A post for the author page test.',
        status: PostStatus.Published,
        publishedAt: new Date(),
        tags: ['blg12'],
        ...fields,
      })),
    );
    const postIds = created.map((post) => post._id.toString());
    createdPostIds.push(...postIds);
    return postIds;
  };

  /** Itineraries written straight to the database, created in this order. */
  const createItineraries = async (
    rows: {
      ownerId: string;
      visibility?: ItineraryVisibility;
      moderation?: ItineraryModeration;
    }[],
  ): Promise<string[]> => {
    const created = await itineraries.insertMany(
      rows.map(({ ownerId, visibility, moderation }) => ({
        ownerId: new Types.ObjectId(ownerId),
        title: `BLG-12 trip ${RUN}`,
        countries: ['EG'],
        startDate: '2026-12-20',
        visibility: visibility ?? ItineraryVisibility.Public,
        moderation: moderation ?? ItineraryModeration.Visible,
      })),
    );
    const itineraryIds = created.map((itinerary) => itinerary._id.toString());
    createdItineraryIds.push(...itineraryIds);
    return itineraryIds;
  };

  const setVisibility = (id: string, visibility: ItineraryVisibility) =>
    http()
      .patch(`/api/itineraries/${id}`)
      .set('Cookie', authorCookie)
      .send({ visibility })
      .expect(200);

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
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));

    let reader: string;
    [author, reader, otherAuthor, suspended, admin, moderator, deactivated] =
      await createUsers([
        { label: 'author', role: Role.User },
        { label: 'reader', role: Role.User },
        { label: 'other-author', role: Role.User },
        { label: 'suspended', role: Role.User, status: UserStatus.Suspended },
        { label: 'admin', role: Role.Admin },
        { label: 'moderator', role: Role.HotelModerator },
        {
          label: 'deactivated',
          role: Role.User,
          status: UserStatus.Deactivated,
        },
      ]);
    authorCookie = await sessionCookieFor(app, author);
    readerCookie = await sessionCookieFor(app, reader);

    const now = Date.now();
    [olderPost, newerPost, draftPost, hiddenPost, otherAuthorsPost] =
      await createPosts([
        { authorId: author, fields: { publishedAt: new Date(now - 60_000) } },
        { authorId: author, fields: { publishedAt: new Date(now - 30_000) } },
        {
          authorId: author,
          fields: { status: PostStatus.Draft, publishedAt: undefined },
        },
        {
          authorId: author,
          fields: {
            publishedAt: new Date(now - 10_000),
            moderation: PostModeration.Hidden,
          },
        },
        { authorId: otherAuthor },
      ]);
    // The suspended author and the accounts without a page have a post too.
    await createPosts([
      { authorId: suspended },
      { authorId: admin },
      { authorId: deactivated },
    ]);

    [olderTrip, newerTrip, privateTrip, hiddenTrip, otherAuthorsTrip] =
      await createItineraries([
        { ownerId: author },
        { ownerId: author },
        { ownerId: author, visibility: ItineraryVisibility.Private },
        { ownerId: author, moderation: ItineraryModeration.Hidden },
        { ownerId: otherAuthor },
      ]);
    // Inserted together, the two public trips can share their updatedAt;
    // a later update makes the order certain.
    await itineraries.findByIdAndUpdate(newerTrip, {
      title: `BLG-12 newer trip ${RUN}`,
    });
  });

  afterAll(async () => {
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdItineraryIds) {
      await itineraries.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('shows a guest and a logged-in user the same page', async () => {
    const asGuest = await page(author).expect(200);
    const asUser = await page(author, {}, readerCookie).expect(200);

    expect(asUser.body).toEqual(asGuest.body);
    const body = asGuest.body as PageBody;
    expect(body.id).toBe(author);
    expect(body.name).toBe(`BLG-12 author ${RUN}`);
    expect(body.joinedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('lists only the published, visible posts of the author, newest first', async () => {
    const body = await pageBody(author);

    expect(ids(body.posts)).toEqual([newerPost, olderPost]);
    expect(body.posts.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('lists a draft once it is published and a hidden post once it is shown', async () => {
    await posts.findByIdAndUpdate(draftPost, {
      status: PostStatus.Published,
      publishedAt: new Date(),
    });
    await posts.findByIdAndUpdate(hiddenPost, {
      moderation: PostModeration.Visible,
    });
    try {
      const body = await pageBody(author);
      expect(ids(body.posts)).toEqual([
        draftPost,
        hiddenPost,
        newerPost,
        olderPost,
      ]);
      expect(body.posts.meta.total).toBe(4);
    } finally {
      await posts.findByIdAndUpdate(draftPost, {
        status: PostStatus.Draft,
        $unset: { publishedAt: 1 },
      });
      await posts.findByIdAndUpdate(hiddenPost, {
        moderation: PostModeration.Hidden,
      });
    }
    expect(ids((await pageBody(author)).posts)).toEqual([newerPost, olderPost]);
  });

  it('lists only the public, visible itineraries of the author, most recently updated first', async () => {
    const body = await pageBody(author);

    expect(ids(body.itineraries)).toEqual([newerTrip, olderTrip]);
    expect(ids(body.itineraries)).not.toContain(privateTrip);
    expect(ids(body.itineraries)).not.toContain(hiddenTrip);
    expect(body.itineraries.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('drops an itinerary made private at once (ITN-20)', async () => {
    await setVisibility(newerTrip, ItineraryVisibility.Private);
    try {
      const body = await pageBody(author);
      expect(ids(body.itineraries)).toEqual([olderTrip]);
      expect(body.itineraries.meta.total).toBe(1);
    } finally {
      await setVisibility(newerTrip, ItineraryVisibility.Public);
    }
    expect(ids((await pageBody(author)).itineraries)).toEqual([
      newerTrip,
      olderTrip,
    ]);
  });

  it("never shows another author's content", async () => {
    const body = await pageBody(author);
    expect(ids(body.posts)).not.toContain(otherAuthorsPost);
    expect(ids(body.itineraries)).not.toContain(otherAuthorsTrip);

    const other = await pageBody(otherAuthor);
    expect(ids(other.posts)).toEqual([otherAuthorsPost]);
    expect(ids(other.itineraries)).toEqual([otherAuthorsTrip]);
  });

  it('pages the posts without moving the itineraries', async () => {
    const body = await pageBody(author, { postsPage: '2', postsLimit: '1' });

    expect(ids(body.posts)).toEqual([olderPost]);
    expect(body.posts.meta).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(ids(body.itineraries)).toEqual([newerTrip, olderTrip]);
    expect(body.itineraries.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('pages the itineraries without moving the posts', async () => {
    const body = await pageBody(author, {
      itinerariesPage: '2',
      itinerariesLimit: '1',
    });

    expect(ids(body.itineraries)).toEqual([olderTrip]);
    expect(body.itineraries.meta).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(ids(body.posts)).toEqual([newerPost, olderPost]);
    expect(body.posts.meta.total).toBe(2);
  });

  it('gives a suspended author a page, with an empty list as items [] and total 0', async () => {
    const body = await pageBody(suspended);

    expect(body.posts.meta.total).toBe(1);
    expect(body.itineraries).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it.each([
    ['an id that is not an id', 'not-an-id', {}],
    ['a posts page size of 0', 'author', { postsLimit: '0' }],
    ['a posts page size above 50', 'author', { postsLimit: '51' }],
    ['an itineraries page size above 50', 'author', { itinerariesLimit: '51' }],
    ['a posts page of 0', 'author', { postsPage: '0' }],
    ['an itineraries page of 0', 'author', { itinerariesPage: '0' }],
    ['an unknown parameter', 'author', { sort: 'title' }],
    ['the plain page parameter', 'author', { page: '2' }],
  ])('answers 400 for %s', async (_label, who, query) => {
    const response = await page(who === 'author' ? author : who, query);
    expect(response.status).toBe(400);
  });

  it.each([
    ['an unknown id', () => new Types.ObjectId().toString()],
    ['an administrator', () => admin],
    ['a moderator', () => moderator],
    ['a deactivated author (ACC-12)', () => deactivated],
  ])('answers the same 404 for %s', async (_label, id) => {
    const response = await page(id());

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Author not found');
  });

  it('answers exactly the whitelisted fields', async () => {
    const body = await pageBody(author);

    expect(Object.keys(body).sort()).toEqual([
      'id',
      'itineraries',
      'joinedAt',
      'name',
      'posts',
    ]);
    expect(Object.keys(body.posts).sort()).toEqual(['items', 'meta']);
    expect(Object.keys(body.itineraries).sort()).toEqual(['items', 'meta']);
    expect(Object.keys(body.posts.items[0]).sort()).toEqual([
      'author',
      'commentCount',
      'excerpt',
      'id',
      'likeCount',
      'publishedAt',
      'tags',
      'title',
    ]);
    expect(Object.keys(body.itineraries.items[0]).sort()).toEqual([
      'author',
      'countries',
      'dayCount',
      'id',
      'moderation',
      'ownerId',
      'startDate',
      'title',
      'visibility',
    ]);
    const text = JSON.stringify(body);
    for (const secret of [
      'email',
      'phone',
      'role',
      'status',
      'passwordHash',
      'preferredCurrency',
    ]) {
      expect(text).not.toContain(`"${secret}"`);
    }
  });

  it('documents the public route with its typed lists in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const doc = response.body as {
      paths: Record<string, Record<string, SwaggerOperation>>;
      components: { schemas: Record<string, SwaggerSchema> };
    };
    const refOf = (schema: SwaggerSchema | undefined): string | undefined =>
      schema?.$ref ?? schema?.allOf?.[0]?.$ref;
    const schemaOf = (ref: string | undefined): SwaggerSchema => {
      expect(ref).toBeDefined();
      return doc.components.schemas[(ref ?? '').split('/').pop() ?? ''];
    };

    const operation = doc.paths['/api/authors/{id}']?.get;
    expect(operation).toBeDefined();
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '404']),
    );
    expect(operation.responses['401']).toBeUndefined();
    expect(operation.security).toBeUndefined();

    const pageRef = refOf(
      operation.responses['200'].content?.['application/json'].schema,
    );
    expect(pageRef).toBe('#/components/schemas/AuthorPageResponseDto');
    const pageSchema = schemaOf(pageRef);

    const postsSchema = schemaOf(refOf(pageSchema.properties?.posts));
    expect(postsSchema.properties?.items.type).toBe('array');
    expect(refOf(postsSchema.properties?.items.items)).toBe(
      '#/components/schemas/PostSummaryResponseDto',
    );
    expect(refOf(postsSchema.properties?.meta)).toBe(
      '#/components/schemas/PaginationMeta',
    );

    const itinerariesSchema = schemaOf(
      refOf(pageSchema.properties?.itineraries),
    );
    expect(itinerariesSchema.properties?.items.type).toBe('array');
    expect(refOf(itinerariesSchema.properties?.items.items)).toBe(
      '#/components/schemas/PublicItineraryResponseDto',
    );
    expect(refOf(itinerariesSchema.properties?.meta)).toBe(
      '#/components/schemas/PaginationMeta',
    );
  });
});
