import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import {
  FAVOURITE_HOTEL_NOT_FOUND_MESSAGE,
  FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
  FAVOURITE_NOT_FOUND_MESSAGE,
  FAVOURITES_LIMIT_MESSAGE,
  FAVOURITES_MAX_PER_USER,
} from './../src/favourites/favourites.constants';
import { Favourite } from './../src/favourites/models/favourite.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { ItineraryModeration } from './../src/itineraries/enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './../src/itineraries/enums/itinerary-visibility.enum';
import { Itinerary } from './../src/itineraries/models/itinerary.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

const RUN = `bon02-${randomUUID().slice(0, 8)}`;

interface FavouriteBody {
  id: string;
  targetType: 'hotel' | 'itinerary';
  targetId: string;
  addedAt: string;
  available: boolean;
  hotel: Record<string, unknown> | null;
  itinerary: Record<string, unknown> | null;
}
interface PageBody {
  items: FavouriteBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * BON-02 end to end, on the "-test" database. The suite makes its own users,
 * hotels (one deactivated) and itineraries (public, private, and public of a
 * deactivated author), and deletes every record by id at the end, its
 * favourites included.
 */
describe('Favourites (e2e, BON-02)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let itineraries: Model<Itinerary>;
  let favourites: Model<Favourite>;
  const userIds: string[] = [];
  const hotelIds: string[] = [];
  const itineraryIds: string[] = [];
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

  const http = () => request(app.getHttpServer());
  const id = (label: string): string => ids.get(label) ?? '';

  const as = <T extends { set: (k: string, v: string) => T }>(
    call: T,
    who?: string,
  ): T => {
    const cookie = who ? cookies.get(who) : undefined;
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const add = (body: object, who = 'owner') =>
    as(http().post('/api/favourites'), who).send(body);
  const list = (query: Record<string, string | number> = {}, who = 'owner') =>
    as(http().get('/api/favourites'), who).query(query);
  const remove = (favouriteId: string, who = 'owner') =>
    as(http().delete(`/api/favourites/${favouriteId}`), who);

  const hotel = (label: string) => ({
    targetType: 'hotel',
    targetId: id(label),
  });
  const itinerary = (label: string) => ({
    targetType: 'itinerary',
    targetId: id(label),
  });

  /** One user's fields; the ids come back from one insertMany per collection. */
  const userFields = (label: string, fields: Record<string, unknown> = {}) => ({
    name: `${RUN} ${label}`,
    email: `${RUN}-${label.toLowerCase()}@example.com`,
    passwordHash: 'not-a-real-hash',
    consentAcceptedAt: new Date(),
    ...fields,
  });

  const hotelFields = (label: string, active = true) => ({
    name: `BON-02 ${label} ${RUN}`,
    addressLine: '2 Nile Street',
    cityId: `${RUN}-city`,
    countryCode: 'QZ',
    description: 'A hotel created by the BON-02 e2e test.',
    photos: ['bon02-photo.jpg'],
    starClass: 4,
    amenities: [],
    ratingCount: 3,
    averageRating: 4.5,
    active,
  });

  const itineraryFields = (
    label: string,
    owner: string,
    fields: Record<string, unknown> = {},
  ) => ({
    ownerId: new Types.ObjectId(id(owner)),
    title: `BON-02 ${label} ${RUN}`,
    countries: ['QZ'],
    startDate: '2026-12-20',
    days: [],
    dayCount: 0,
    visibility: ItineraryVisibility.Public,
    ...fields,
  });

  const storedCount = (userLabel: string) =>
    favourites.countDocuments({ userId: new Types.ObjectId(id(userLabel)) });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    favourites = app.get<Model<Favourite>>(getModelToken(Favourite.name));
    // The unique index must exist before the duplicate tests.
    await favourites.init();

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database (see admin-audit-logs).
    const userLabels: [string, Record<string, unknown>][] = [
      ['owner', {}],
      ['other', {}],
      ['author', {}],
      ['limited', {}],
      ['racer', {}],
      ['upper', {}],
      ['gone', { status: UserStatus.Deactivated }],
      ['admin', { role: Role.Admin }],
      [
        'moderator',
        {
          role: Role.HotelModerator,
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: new Types.ObjectId(),
          },
        },
      ],
    ];
    const createdUsers = await users.insertMany(
      userLabels.map(([label, fields]) => userFields(label, fields)),
    );
    createdUsers.forEach((user, index) => {
      userIds.push(user._id.toString());
      ids.set(userLabels[index][0], user._id.toString());
    });
    for (const [label, fields] of userLabels) {
      if (fields.status !== UserStatus.Deactivated) {
        cookies.set(label, await sessionCookieFor(app, id(label)));
      }
    }

    const hotelLabels: [string, boolean][] = [
      ['garden', true],
      ['sea', true],
      ['later', true],
      ['closed', false],
    ];
    const createdHotels = await hotels.insertMany(
      hotelLabels.map(([label, active]) => hotelFields(label, active)),
    );
    createdHotels.forEach((hotel, index) => {
      hotelIds.push(hotel._id.toString());
      ids.set(hotelLabels[index][0], hotel._id.toString());
    });

    const itineraryLabels: [string, string, Record<string, unknown>][] = [
      ['public', 'author', {}],
      ['made-private', 'author', {}],
      ['mine-private', 'owner', { visibility: ItineraryVisibility.Private }],
      ['their-private', 'author', { visibility: ItineraryVisibility.Private }],
      ['hidden', 'author', { moderation: ItineraryModeration.Hidden }],
      ['gone-author', 'gone', { authorDeactivated: true }],
    ];
    const createdItineraries = await itineraries.insertMany(
      itineraryLabels.map(([label, owner, fields]) =>
        itineraryFields(label, owner, fields),
      ),
    );
    createdItineraries.forEach((itinerary, index) => {
      itineraryIds.push(itinerary._id.toString());
      ids.set(itineraryLabels[index][0], itinerary._id.toString());
    });
  });

  afterAll(async () => {
    if (!app) return;
    // Exactly the records of this suite, by their ids: never a broad filter.
    const favouriteIds = (
      await favourites
        .find({
          userId: { $in: userIds.map((userId) => new Types.ObjectId(userId)) },
        })
        .select('_id')
        .lean()
        .exec()
    ).map(({ _id }) => _id);
    if (favouriteIds.length > 0) {
      await favourites.deleteMany({ _id: { $in: favouriteIds } }).exec();
    }
    if (itineraryIds.length > 0) {
      await itineraries.deleteMany({ _id: { $in: itineraryIds } }).exec();
    }
    if (hotelIds.length > 0) {
      await hotels.deleteMany({ _id: { $in: hotelIds } }).exec();
    }
    for (const userId of userIds) {
      await deleteSessionsOf(app, userId);
    }
    if (userIds.length > 0) {
      await users.deleteMany({ _id: { $in: userIds } }).exec();
    }
    await app.close();
  });

  it('saves an active hotel (201) with its public card, and the same hotel again answers 200 with the same favourite and no second document', async () => {
    const first = await add(hotel('garden'));

    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      targetType: 'hotel',
      targetId: id('garden'),
      addedAt: expect.stringMatching(/Z$/),
      available: true,
      hotel: {
        name: `BON-02 garden ${RUN}`,
        cityId: `${RUN}-city`,
        countryCode: 'QZ',
        starClass: 4,
        averageRating: 4.5,
        ratingCount: 3,
        photoUrl: '/api/uploads/bon02-photo.jpg',
      },
      itinerary: null,
    });

    const again = await add(hotel('garden'));

    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(
      await favourites.countDocuments({
        userId: new Types.ObjectId(id('owner')),
        targetId: new Types.ObjectId(id('garden')),
      }),
    ).toBe(1);
  });

  it('saves a public itinerary with its title and author name, never the author id', async () => {
    const response = await add(itinerary('public'));

    expect(response.status).toBe(201);
    expect(response.body.itinerary).toEqual({
      title: `BON-02 public ${RUN}`,
      authorName: `${RUN} author`,
      countries: ['QZ'],
      startDate: '2026-12-20',
      dayCount: 0,
    });
    expect(JSON.stringify(response.body)).not.toContain(id('author'));
  });

  it.each([
    [
      'a deactivated hotel',
      'hotel',
      'closed',
      FAVOURITE_HOTEL_NOT_FOUND_MESSAGE,
    ],
    [
      'the caller’s own private itinerary',
      'itinerary',
      'mine-private',
      FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
    ],
    [
      'another user’s private itinerary',
      'itinerary',
      'their-private',
      FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
    ],
    [
      'a public itinerary hidden by an administrator',
      'itinerary',
      'hidden',
      FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
    ],
    [
      'a public itinerary of a deactivated author',
      'itinerary',
      'gone-author',
      FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
    ],
  ])(
    'answers 404 for %s and saves nothing',
    async (_label, targetType, target, message) => {
      const before = await storedCount('owner');

      const response = await add({ targetType, targetId: id(target) });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe(message);
      expect(await storedCount('owner')).toBe(before);
    },
  );

  it.each([
    ['hotel', FAVOURITE_HOTEL_NOT_FOUND_MESSAGE],
    ['itinerary', FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE],
  ])(
    'answers 404 for a %s that does not exist',
    async (targetType, message) => {
      const response = await add({
        targetType,
        targetId: new Types.ObjectId().toString(),
      });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe(message);
    },
  );

  it.each([
    [
      'another type',
      { targetType: 'flight', targetId: new Types.ObjectId().toString() },
      'targetType',
    ],
    [
      'an id that is not an id',
      { targetType: 'hotel', targetId: 'abc' },
      'targetId',
    ],
    [
      'the owner in the body',
      {
        targetType: 'hotel',
        targetId: new Types.ObjectId().toString(),
        userId: new Types.ObjectId().toString(),
      },
      'userId',
    ],
  ])('answers 400 for %s', async (_label, body, field) => {
    const response = await add(body);

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });

  it('lists only my favourites, newest first, with a stable total across pages, and filters by type', async () => {
    // A favourite of another user, which must never show.
    expect((await add(hotel('sea'), 'other')).status).toBe(201);
    expect((await add(hotel('sea'))).status).toBe(201);

    const all = await list();
    expect(all.status).toBe(200);
    const body = all.body as PageBody;
    expect(body.items.map((item) => item.targetId)).toEqual([
      id('sea'),
      id('public'),
      id('garden'),
    ]);
    expect(body.meta).toEqual({ page: 1, limit: 10, total: 3, totalPages: 1 });

    const pages = [await list({ limit: 2 }), await list({ limit: 2, page: 2 })];
    expect(pages.map((page) => (page.body as PageBody).meta.total)).toEqual([
      3, 3,
    ]);
    expect(
      pages.flatMap((page) =>
        (page.body as PageBody).items.map((item) => item.targetId),
      ),
    ).toEqual([id('sea'), id('public'), id('garden')]);

    const onlyItineraries = (await list({ targetType: 'itinerary' }))
      .body as PageBody;
    expect(onlyItineraries.items.map((item) => item.targetId)).toEqual([
      id('public'),
    ]);
    expect(onlyItineraries.meta.total).toBe(1);

    const theirs = (await list({}, 'other')).body as PageBody;
    expect(theirs.items.map((item) => item.targetId)).toEqual([id('sea')]);
  });

  it('keeps a hotel deactivated after it was saved, as not available with no card, and lets me remove it', async () => {
    const saved = (await add(hotel('later'))).body as FavouriteBody;
    await hotels
      .updateOne({ _id: id('later') }, { $set: { active: false } })
      .exec();

    const listed = ((await list()).body as PageBody).items.find(
      (item) => item.id === saved.id,
    );
    expect(listed).toMatchObject({
      available: false,
      hotel: null,
      itinerary: null,
    });

    expect((await remove(saved.id)).status).toBe(204);
  });

  it('keeps an itinerary made private after it was saved, as not available with no card', async () => {
    const saved = (await add(itinerary('made-private'))).body as FavouriteBody;
    expect(saved.available).toBe(true);
    await itineraries
      .updateOne(
        { _id: id('made-private') },
        { $set: { visibility: ItineraryVisibility.Private } },
      )
      .exec();

    const listed = (
      (await list({ targetType: 'itinerary' })).body as PageBody
    ).items.find((item) => item.id === saved.id);

    expect(listed).toMatchObject({
      available: false,
      hotel: null,
      itinerary: null,
    });
    expect((await remove(saved.id)).status).toBe(204);
  });

  it('accepts a target id written in upper case as the same target', async () => {
    const first = await add(
      { targetType: 'hotel', targetId: id('garden').toUpperCase() },
      'upper',
    );
    const again = await add(hotel('garden'), 'upper');

    expect(first.status).toBe(201);
    expect(first.body.targetId).toBe(id('garden'));
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('removes my favourite (204), and a second removal answers 404', async () => {
    const saved = (await add(itinerary('public'))).body as FavouriteBody;

    expect((await remove(saved.id)).status).toBe(204);
    const again = await remove(saved.id);

    expect(again.status).toBe(404);
    expect(again.body.message).toBe(FAVOURITE_NOT_FOUND_MESSAGE);
  });

  it("answers 404 to removing another user's favourite and keeps it, and never lists it", async () => {
    const theirs = (await add(hotel('sea'), 'other')).body as FavouriteBody;

    const response = await remove(theirs.id);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(FAVOURITE_NOT_FOUND_MESSAGE);
    expect(await favourites.exists({ _id: theirs.id })).not.toBeNull();
    const mine = ((await list()).body as PageBody).items;
    expect(mine.map((item) => item.id)).not.toContain(theirs.id);
  });

  it('answers 400 to removing with an id that is not an id', async () => {
    expect((await remove('not-an-id')).status).toBe(400);
  });

  it('ends two identical adds at the same moment with one document and no 500: one 201 and one 200', async () => {
    const answers = await Promise.all([
      add(hotel('garden'), 'racer'),
      add(hotel('garden'), 'racer'),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 201]);
    // Both read the one stored favourite: the same body, the same addedAt.
    expect(answers[0].body).toEqual(answers[1].body);
    expect(await storedCount('racer')).toBe(1);
  });

  it('answers 401 to a guest, and 403 to a moderator and an administrator, on every route', async () => {
    const someId = new Types.ObjectId().toString();
    for (const [who, status] of [
      ['guest', 401],
      ['moderator', 403],
      ['admin', 403],
    ] as const) {
      expect((await add(hotel('garden'), who)).status).toBe(status);
      expect((await list({}, who)).status).toBe(status);
      expect((await remove(someId, who)).status).toBe(status);
    }
  });

  it(`answers 409 to a new favourite past ${FAVOURITES_MAX_PER_USER}, and saves nothing`, async () => {
    const owner = new Types.ObjectId(id('limited'));
    // Deleted by id in afterAll, with every favourite of this suite's users.
    await favourites.insertMany(
      Array.from({ length: FAVOURITES_MAX_PER_USER }, () => ({
        userId: owner,
        targetType: 'hotel',
        targetId: new Types.ObjectId(),
      })),
    );

    const response = await add(hotel('garden'), 'limited');

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(FAVOURITES_LIMIT_MESSAGE);
    expect(await storedCount('limited')).toBe(FAVOURITES_MAX_PER_USER);
  });

  it('documents the three routes, their answers and the response in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<
        string,
        {
          summary: string;
          tags: string[];
          security?: unknown[];
          responses: Record<string, unknown>;
        }
      >
    >;

    const routes = [
      [
        paths['/api/favourites'].post,
        ['200', '201', '400', '401', '403', '404', '409'],
      ],
      [paths['/api/favourites'].get, ['200', '400', '401', '403']],
      [
        paths['/api/favourites/{id}'].delete,
        ['204', '400', '401', '403', '404'],
      ],
    ] as const;
    for (const [operation, answers] of routes) {
      expect(operation.summary).toContain('BON-02');
      expect(operation.tags).toEqual(['favourites']);
      expect(operation.security).toEqual([{ cookie: [] }]);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining([...answers]),
      );
    }
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    expect(Object.keys(schemas.FavouriteResponseDto.properties).sort()).toEqual(
      [
        'addedAt',
        'available',
        'hotel',
        'id',
        'itinerary',
        'targetId',
        'targetType',
      ],
    );
  });
});
