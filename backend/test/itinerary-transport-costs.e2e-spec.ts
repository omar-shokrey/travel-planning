import './support/auth-env';
import { Types } from 'mongoose';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type DetailBody,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';

interface TransportBody {
  id: string;
  mode: string;
  fromCityId: string;
  toCityId: string;
  amount: number;
  currency: string;
}

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  responses: Record<string, unknown>;
}

describe('Transport costs (e2e, ITN-16)', () => {
  let fixture: ItineraryFixture;
  let owner: FixtureUser;
  let otherUser: FixtureUser;

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    owner = await fixture.createUser();
    otherUser = await fixture.createUser();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  const trip = (itinerary: DetailBody, dayIndex = 0) => ({
    dayId: itinerary.days[dayIndex].id,
    mode: 'train',
    fromCityId: fixture.cityA,
    toCityId: fixture.cityB,
    amount: 9000,
    currency: FIXTURE_CURRENCY,
  });
  const addCost = (
    itinerary: DetailBody,
    body: Record<string, unknown>,
    user = owner,
  ) =>
    fixture
      .http()
      .post(`/api/itineraries/${itinerary.id}/transport-costs`)
      .set('Cookie', user.cookie)
      .send(body);
  const editCost = (id: string, body: Record<string, unknown>, user = owner) =>
    fixture
      .http()
      .patch(`/api/transport-costs/${id}`)
      .set('Cookie', user.cookie)
      .send(body);
  const deleteCost = (id: string, user = owner) =>
    fixture
      .http()
      .delete(`/api/transport-costs/${id}`)
      .set('Cookie', user.cookie);

  /** An itinerary A then B, with the train from A to B on day 1. */
  const withTrain = async () => {
    const itinerary = await fixture.createItinerary(owner, [
      fixture.cityA,
      fixture.cityB,
    ]);
    const added = await addCost(itinerary, trip(itinerary)).expect(201);
    const cost = added.body.days[0].transportCosts[0] as TransportBody;
    return { itinerary, cost };
  };

  describe('POST /api/itineraries/:id/transport-costs', () => {
    it('adds the transport cost to its day and counts it in that city group', async () => {
      const itinerary = await fixture.createItinerary(owner, [
        fixture.cityA,
        fixture.cityB,
      ]);

      const response = await addCost(itinerary, {
        ...trip(itinerary),
        mode: '  bus  ',
      }).expect(201);

      expect(response.body.days[0].transportCosts).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          mode: 'bus',
          fromCityId: fixture.cityA,
          toCityId: fixture.cityB,
          amount: 9000,
          currency: FIXTURE_CURRENCY,
        },
      ]);
      expect(response.body.days[1].transportCosts).toEqual([]);
      expect(
        (response.body.cityGroups as { budgetSubtotal: unknown[] }[]).map(
          (group) => group.budgetSubtotal,
        ),
      ).toEqual([[{ amount: 9000, currency: FIXTURE_CURRENCY }], []]);
    });

    it.each([
      ['no day', { dayId: undefined }, 'dayId'],
      ['no mode', { mode: '' }, 'mode'],
      ['a negative amount', { amount: -5 }, 'amount'],
      ['a fractional amount', { amount: 1.5 }, 'amount'],
      ['a currency that is not a code', { currency: 'dollars' }, 'currency'],
      ['a field the client may not send', { total: 1 }, 'total'],
    ])('rejects %s with 400', async (_label, change, field) => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const response = await addCost(itinerary, {
        ...trip(itinerary),
        ...change,
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: expect.any(Array) },
      ]);
    });

    it.each([
      [
        'the same city twice',
        'same',
        'fromCityId and toCityId must be different cities',
      ],
      [
        'a city that is not in the city list',
        'unknown',
        'Unknown city id: atlantis',
      ],
      [
        'a currency that is not supported',
        'currency',
        'Unsupported currency: ZZZ',
      ],
    ])('rejects %s', async (_label, kind, message) => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const body = {
        ...trip(itinerary),
        ...(kind === 'same' ? { toCityId: fixture.cityA } : {}),
        ...(kind === 'unknown' ? { toCityId: 'atlantis' } : {}),
        ...(kind === 'currency' ? { currency: 'ZZZ' } : {}),
      };

      const response = await addCost(itinerary, body);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(message);
    });

    it('answers 403 to another user and 404 for a day of another itinerary', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const other = await fixture.createItinerary(owner, [fixture.cityA]);

      const forbidden = await addCost(itinerary, trip(itinerary), otherUser);
      const wrongDay = await addCost(itinerary, trip(other));

      expect(forbidden.status).toBe(403);
      expect(wrongDay.status).toBe(404);
    });
  });

  describe('PATCH /api/transport-costs/:id', () => {
    it('changes only the fields that are sent', async () => {
      const { cost } = await withTrain();

      const response = await editCost(cost.id, {
        mode: 'night train',
        amount: 9500,
      }).expect(200);

      expect(response.body.days[0].transportCosts).toEqual([
        { ...cost, mode: 'night train', amount: 9500 },
      ]);
    });

    it('moves it to another day of the same itinerary, with the same id', async () => {
      const { itinerary, cost } = await withTrain();

      const response = await editCost(cost.id, {
        dayId: itinerary.days[1].id,
      }).expect(200);

      expect(response.body.days[0].transportCosts).toEqual([]);
      expect(response.body.days[1].transportCosts).toEqual([cost]);
    });

    it('refuses null, the same city twice and a day of another itinerary', async () => {
      const { cost } = await withTrain();
      const other = await fixture.createItinerary(owner, [fixture.cityA]);

      const nullAmount = await editCost(cost.id, { amount: null });
      const sameCity = await editCost(cost.id, { toCityId: fixture.cityA });
      const wrongDay = await editCost(cost.id, { dayId: other.days[0].id });

      expect(nullAmount.status).toBe(400);
      expect(nullAmount.body.errors).toEqual([
        { field: 'amount', messages: ['amount must not be null'] },
      ]);
      expect(sameCity.status).toBe(400);
      expect(wrongDay.status).toBe(404);
    });

    it('answers 403 to another user and changes nothing', async () => {
      const { itinerary, cost } = await withTrain();

      const response = await editCost(cost.id, { amount: 1 }, otherUser);

      expect(response.status).toBe(403);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.days[0].transportCosts[0].amount).toBe(9000);
    });

    it('answers 404 for an id that is no transport cost and 400 for a bad id', async () => {
      const missing = await editCost(new Types.ObjectId().toString(), {
        amount: 1,
      });
      const badId = await editCost('not-an-id', { amount: 1 });

      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe('Transport cost not found');
      expect(badId.status).toBe(400);
    });
  });

  describe('DELETE /api/transport-costs/:id', () => {
    it('removes it and its amount from the budget', async () => {
      const { cost } = await withTrain();

      const response = await deleteCost(cost.id).expect(200);

      expect(response.body.days[0].transportCosts).toEqual([]);
      expect(response.body.cityGroups[0].budgetSubtotal).toEqual([]);
      expect((await deleteCost(cost.id)).status).toBe(404);
    });

    it('answers 403 to another user and deletes nothing', async () => {
      const { itinerary, cost } = await withTrain();

      const response = await deleteCost(cost.id, otherUser);

      expect(response.status).toBe(403);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.days[0].transportCosts).toHaveLength(1);
    });
  });

  it('documents the ITN-16 routes in Swagger', async () => {
    const response = await fixture.http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const operations = [
      paths['/api/itineraries/{id}/transport-costs'].post,
      paths['/api/transport-costs/{id}'].patch,
      paths['/api/transport-costs/{id}'].delete,
    ];

    for (const operation of operations) {
      expect(operation.tags).toEqual(['Itineraries']);
      expect(operation.description).toMatch(/^ITN-16\. /);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['400', '401', '403', '404', '409']),
      );
    }
  });
});
