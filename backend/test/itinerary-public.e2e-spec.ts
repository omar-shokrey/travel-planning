import './support/auth-env';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { ItineraryModeration } from './../src/itineraries/enums/itinerary-moderation.enum';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type DetailBody,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';

interface SearchItem {
  id: string;
  title: string;
  dayCount: number;
  visibility: string;
  author: { id: string; name: string };
}

interface SearchBody {
  items: SearchItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  security?: unknown[];
}

describe('Public itineraries (e2e, ITN-21)', () => {
  let fixture: ItineraryFixture;
  let author: FixtureUser;
  let reader: FixtureUser;
  /** A word in the titles of this file's itineraries only, so other tests' data never shows. */
  const token = `zq${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    author = await fixture.createUser();
    reader = await fixture.createUser();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  const search = (params: Record<string, string | number> = {}) =>
    fixture.http().get('/api/itineraries/public/search').query(params);
  /** Search results limited to this file's itineraries, as ids. */
  const foundIds = async (params: Record<string, string | number> = {}) => {
    const response = await search({ q: token, limit: 50, ...params }).expect(
      200,
    );
    return (response.body as SearchBody).items.map((item) => item.id);
  };
  const setVisibility = (itinerary: DetailBody, visibility: string) =>
    fixture
      .http()
      .patch(`/api/itineraries/${itinerary.id}`)
      .set('Cookie', author.cookie)
      .send({ visibility })
      .expect(200);
  /** A public itinerary of the author, one day per city given. */
  const createPublic = async (cities: string[], title = `Trip ${token}`) => {
    const itinerary = await fixture.createItinerary(author, cities, title);
    await setVisibility(itinerary, 'public');
    return itinerary;
  };
  const clone = (id: string, user?: FixtureUser) => {
    const call = fixture.http().post(`/api/itineraries/${id}/clone`);
    return user ? call.set('Cookie', user.cookie) : call;
  };

  describe('search (guest)', () => {
    let shortTrip: DetailBody;
    let longTrip: DetailBody;
    let privateTrip: DetailBody;

    beforeAll(async () => {
      shortTrip = await createPublic([fixture.cityA], `Short ${token}`);
      longTrip = await createPublic(
        [fixture.cityA, fixture.cityB, fixture.cityB],
        `Long ${token}`,
      );
      privateTrip = await fixture.createItinerary(
        author,
        [fixture.cityA],
        `Private ${token}`,
      );
    });

    it('lists public itineraries with their author, without logging in', async () => {
      const response = await search({ q: token }).expect(200);
      const body = response.body as SearchBody;

      expect(body.items.map((item) => item.id).sort()).toEqual(
        [shortTrip.id, longTrip.id].sort(),
      );
      expect(body.meta.total).toBe(2);
      const long = body.items.find((item) => item.id === longTrip.id);
      expect(long).toMatchObject({
        title: `Long ${token}`,
        dayCount: 3,
        visibility: 'public',
        author: { id: author.id, name: author.name },
      });
      expect(long).not.toHaveProperty('days');
    });

    it('never shows a private itinerary', async () => {
      expect(await foundIds()).not.toContain(privateTrip.id);
    });

    it('removes an itinerary from the results as soon as it is made private (ITN-20)', async () => {
      const trip = await createPublic([fixture.cityA], `Leaving ${token}`);
      expect(await foundIds()).toContain(trip.id);

      await setVisibility(trip, 'private');

      expect(await foundIds()).not.toContain(trip.id);
      await fixture
        .http()
        .get(`/api/itineraries/public/${trip.id}`)
        .expect(404);
    });

    it('never shows an itinerary hidden by an admin or by a deactivated author', async () => {
      const hidden = await createPublic([fixture.cityA], `Hidden ${token}`);
      const deactivated = await createPublic(
        [fixture.cityA],
        `Deactivated ${token}`,
      );
      await fixture.itineraries.updateOne(
        { _id: hidden.id },
        { $set: { moderation: ItineraryModeration.Hidden } },
      );
      await fixture.itineraries.updateOne(
        { _id: deactivated.id },
        { $set: { authorDeactivated: true } },
      );

      const ids = await foundIds();
      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(deactivated.id);
      await fixture
        .http()
        .get(`/api/itineraries/public/${hidden.id}`)
        .expect(404);
    });

    it('matches the keyword in any case and as part of the title', async () => {
      const ids = await foundIds({ q: `SHORT ${token.toUpperCase()}` });
      expect(ids).toEqual([shortTrip.id]);
    });

    it('matches the keyword in a country or a city name', async () => {
      const byCountryCode = await foundIds({ q: fixture.country });
      expect(byCountryCode).toEqual(
        expect.arrayContaining([shortTrip.id, longTrip.id]),
      );
      const byCityName = await foundIds({ q: 'Itineraries e2e fixture' });
      expect(byCityName).toEqual(
        expect.arrayContaining([shortTrip.id, longTrip.id]),
      );
    });

    it('filters by duration', async () => {
      expect(await foundIds({ minDays: 2 })).toEqual([longTrip.id]);
      expect(await foundIds({ maxDays: 2 })).toEqual([shortTrip.id]);
      expect(await foundIds({ minDays: 1, maxDays: 3 })).toHaveLength(2);
    });

    it('filters by country and by city', async () => {
      expect(await foundIds({ country: fixture.country })).toHaveLength(2);
      expect(await foundIds({ city: fixture.cityB })).toEqual([longTrip.id]);
      expect(await foundIds({ country: 'ZZ' })).toEqual([]);
    });

    it('pages the results', async () => {
      const response = await search({ q: token, limit: 1, page: 2 }).expect(
        200,
      );
      expect(response.body.meta).toEqual({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(response.body.items).toHaveLength(1);
    });

    it.each([
      [{ minDays: 5, maxDays: 2 }, 'minDays must not be greater than maxDays'],
      [{ minDays: 0 }, 'minDays'],
      [{ maxDays: 61 }, 'maxDays'],
      [{ minDays: 'two' }, 'minDays'],
      [{ country: 'egypt' }, 'country'],
      [{ ownerId: 'abc' }, 'ownerId'],
    ])('rejects the query %j with 400', async (params, mentioned) => {
      const response = await search(
        params as Record<string, string | number>,
      ).expect(400);
      expect(JSON.stringify(response.body)).toContain(mentioned);
    });
  });

  describe('public view (guest)', () => {
    it('shows a public itinerary read-only with its author, days, activities and budget', async () => {
      const trip = await createPublic([fixture.cityA, fixture.cityB]);
      await fixture
        .http()
        .post(`/api/itineraries/${trip.id}/days/${trip.days[0].id}/activities`)
        .set('Cookie', author.cookie)
        .send({ name: 'Old town walk', cost: 1500, currency: FIXTURE_CURRENCY })
        .expect(201);

      const response = await fixture
        .http()
        .get(`/api/itineraries/public/${trip.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: trip.id,
        visibility: 'public',
        dayCount: 2,
        author: { id: author.id, name: author.name },
        days: [
          {
            cityId: fixture.cityA,
            date: '2026-12-20',
            activities: [{ name: 'Old town walk', cost: 1500 }],
          },
          { cityId: fixture.cityB, date: '2026-12-21', activities: [] },
        ],
      });
      expect(response.body.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 1500, currency: FIXTURE_CURRENCY },
      ]);
    });

    it('answers 404 for a private itinerary, even to a logged-in user', async () => {
      const trip = await fixture.createItinerary(author, [fixture.cityA]);
      await fixture
        .http()
        .get(`/api/itineraries/public/${trip.id}`)
        .set('Cookie', reader.cookie)
        .expect(404);
    });

    it('answers 404 for an unknown id and 400 for an invalid one', async () => {
      await fixture
        .http()
        .get(`/api/itineraries/public/${new Types.ObjectId().toString()}`)
        .expect(404);
      await fixture.http().get('/api/itineraries/public/not-an-id').expect(400);
    });

    it('does not let another user change a public itinerary', async () => {
      const trip = await createPublic([fixture.cityA]);
      await fixture
        .http()
        .patch(`/api/itineraries/${trip.id}`)
        .set('Cookie', reader.cookie)
        .send({ title: 'Taken over' })
        .expect(403);
    });
  });

  describe('clone', () => {
    it('asks a guest to log in', async () => {
      const trip = await createPublic([fixture.cityA]);
      const response = await clone(trip.id).expect(401);
      expect(response.body.message).toBe('You must log in to do this');
    });

    it('makes a private copy for the reader with new ids, crediting the author', async () => {
      const trip = await createPublic([fixture.cityA, fixture.cityB]);
      await fixture
        .http()
        .post(`/api/itineraries/${trip.id}/days/${trip.days[0].id}/activities`)
        .set('Cookie', author.cookie)
        .send({ name: 'Market', time: '09:30' })
        .expect(201);
      await fixture
        .http()
        .post(`/api/itineraries/${trip.id}/transport-costs`)
        .set('Cookie', author.cookie)
        .send({
          dayId: trip.days[0].id,
          mode: 'bus',
          fromCityId: fixture.cityA,
          toCityId: fixture.cityB,
          amount: 700,
          currency: FIXTURE_CURRENCY,
        })
        .expect(201);
      const original = await fixture
        .http()
        .get(`/api/itineraries/public/${trip.id}`)
        .expect(200);

      const response = await clone(trip.id, reader).expect(201);
      const copy = response.body;

      expect(copy.id).not.toBe(trip.id);
      expect(copy).toMatchObject({
        ownerId: reader.id,
        title: original.body.title,
        visibility: 'private',
        dayCount: 2,
        startDate: '2026-12-20',
        clonedFrom: {
          itineraryId: trip.id,
          authorId: author.id,
          authorName: author.name,
        },
      });
      expect(copy.days.map((day: { cityId: string }) => day.cityId)).toEqual([
        fixture.cityA,
        fixture.cityB,
      ]);
      expect(copy.days[0].activities).toEqual([
        { id: expect.any(String), name: 'Market', time: '09:30' },
      ]);
      expect(copy.days[0].transportCosts).toEqual([
        expect.objectContaining({ mode: 'bus', amount: 700 }),
      ]);
      expect(copy.days[0].id).not.toBe(original.body.days[0].id);
      expect(copy.days[0].activities[0].id).not.toBe(
        original.body.days[0].activities[0].id,
      );
      expect(copy.days[0].transportCosts[0].id).not.toBe(
        original.body.days[0].transportCosts[0].id,
      );

      // The copy is the reader's own: in their list, not in the search.
      const mine = await fixture
        .http()
        .get('/api/itineraries')
        .set('Cookie', reader.cookie)
        .expect(200);
      expect(mine.body.items.map((item: { id: string }) => item.id)).toContain(
        copy.id,
      );
      expect(await foundIds()).not.toContain(copy.id);
    });

    it('keeps the copy and the original independent', async () => {
      const trip = await createPublic([fixture.cityA]);
      const copy = (await clone(trip.id, reader).expect(201))
        .body as DetailBody;

      await fixture
        .http()
        .patch(`/api/itineraries/${copy.id}/days/${copy.days[0].id}`)
        .set('Cookie', reader.cookie)
        .send({ notes: 'My own plan' })
        .expect(200);
      const original = await fixture
        .http()
        .get(`/api/itineraries/public/${trip.id}`)
        .expect(200);
      expect(original.body.days[0]).not.toHaveProperty('notes');

      await fixture
        .http()
        .delete(`/api/itineraries/${trip.id}`)
        .set('Cookie', author.cookie)
        .expect(204);
      const kept = await fixture
        .http()
        .get(`/api/itineraries/${copy.id}`)
        .set('Cookie', reader.cookie)
        .expect(200);
      expect(kept.body.days[0].notes).toBe('My own plan');
      expect(kept.body.clonedFrom.authorName).toBe(author.name);
    });

    it('answers 404 for a private itinerary and copies nothing', async () => {
      const trip = await fixture.createItinerary(author, [fixture.cityA]);
      const before = await fixture.itineraries.countDocuments({
        ownerId: reader.id,
      });

      await clone(trip.id, reader).expect(404);

      expect(
        await fixture.itineraries.countDocuments({ ownerId: reader.id }),
      ).toBe(before);
    });
  });

  it('documents the ITN-21 routes in Swagger, open to guests except clone', async () => {
    const response = await fixture.http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const searchRoute = paths['/api/itineraries/public/search'].get;
    const viewRoute = paths['/api/itineraries/public/{id}'].get;
    const cloneRoute = paths['/api/itineraries/{id}/clone'].post;

    for (const operation of [searchRoute, viewRoute, cloneRoute]) {
      expect(operation.tags).toEqual(['Itineraries']);
      expect(operation.description).toMatch(/^ITN-21\. /);
    }
    expect(searchRoute.security ?? []).toEqual([]);
    expect(viewRoute.security ?? []).toEqual([]);
    expect(cloneRoute.security).toEqual([{ cookie: [] }]);
  });
});
