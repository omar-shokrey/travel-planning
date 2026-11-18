import './support/auth-env';
import { Types } from 'mongoose';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type DetailBody,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';

interface ActivityBody {
  id: string;
  name: string;
  description?: string;
  time?: string;
  cost?: number;
  currency?: string;
}

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  responses: Record<string, unknown>;
}

describe('Activities (e2e, ITN-10)', () => {
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

  const addActivity = (
    itinerary: DetailBody,
    dayIndex: number,
    body: Record<string, unknown>,
    user = owner,
  ) =>
    fixture
      .http()
      .post(
        `/api/itineraries/${itinerary.id}/days/${itinerary.days[dayIndex].id}/activities`,
      )
      .set('Cookie', user.cookie)
      .send(body);
  const editActivity = (
    id: string,
    body: Record<string, unknown>,
    user = owner,
  ) =>
    fixture
      .http()
      .patch(`/api/activities/${id}`)
      .set('Cookie', user.cookie)
      .send(body);
  const deleteActivity = (id: string, user = owner) =>
    fixture.http().delete(`/api/activities/${id}`).set('Cookie', user.cookie);

  /** An itinerary with two days in city A and one activity with a cost on day 1. */
  const withMuseum = async () => {
    const itinerary = await fixture.createItinerary(owner, [
      fixture.cityA,
      fixture.cityA,
    ]);
    const added = await addActivity(itinerary, 0, {
      name: 'Museum',
      description: 'Two hours',
      time: '09:30',
      cost: 2000,
      currency: FIXTURE_CURRENCY,
    }).expect(201);
    const activity = added.body.days[0].activities[0] as ActivityBody;
    return { itinerary, activity };
  };

  describe('POST /api/itineraries/:id/days/:dayId/activities', () => {
    it('adds an activity to that day and returns the itinerary', async () => {
      const itinerary = await fixture.createItinerary(owner, [
        fixture.cityA,
        fixture.cityA,
      ]);

      const response = await addActivity(itinerary, 1, {
        name: '  Pyramids  ',
        time: '08:00',
        cost: 3000,
        currency: FIXTURE_CURRENCY,
      }).expect(201);

      expect(response.body.days[0].activities).toEqual([]);
      expect(response.body.days[1].activities).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          name: 'Pyramids',
          time: '08:00',
          cost: 3000,
          currency: FIXTURE_CURRENCY,
          images: [],
        },
      ]);
      expect(response.body.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 3000, currency: FIXTURE_CURRENCY },
      ]);
    });

    it('adds an activity with only a name, and keeps the order they were added', async () => {
      const { itinerary } = await withMuseum();

      const response = await addActivity(itinerary, 0, {
        name: 'Walk',
      }).expect(201);

      expect(
        (response.body.days[0].activities as ActivityBody[]).map(
          (activity) => activity.name,
        ),
      ).toEqual(['Museum', 'Walk']);
      expect(response.body.days[0].activities[1]).toEqual({
        id: expect.any(String),
        name: 'Walk',
        images: [],
      });
    });

    it.each([
      ['no name', { time: '09:00' }, 'name'],
      ['a time that is not HH:mm', { name: 'x', time: '9am' }, 'time'],
      ['a negative cost', { name: 'x', cost: -1, currency: 'USD' }, 'cost'],
      ['a fractional cost', { name: 'x', cost: 10.5, currency: 'USD' }, 'cost'],
      ['a cost without a currency', { name: 'x', cost: 100 }, 'currency'],
      ['a currency without a cost', { name: 'x', currency: 'USD' }, 'cost'],
      ['a field the client may not send', { name: 'x', images: [] }, 'images'],
    ])('rejects %s with 400', async (_label, body, field) => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const response = await addActivity(itinerary, 0, body);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: expect.any(Array) },
      ]);
    });

    it('rejects a currency that is not supported', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const response = await addActivity(itinerary, 0, {
        name: 'x',
        cost: 100,
        currency: 'ZZZ',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Unsupported currency: ZZZ');
    });

    it('answers 403 to another user and 404 for a day of another itinerary', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const other = await fixture.createItinerary(owner, [fixture.cityA]);

      const forbidden = await addActivity(
        itinerary,
        0,
        { name: 'x' },
        otherUser,
      );
      const wrongDay = await fixture
        .http()
        .post(
          `/api/itineraries/${itinerary.id}/days/${other.days[0].id}/activities`,
        )
        .set('Cookie', owner.cookie)
        .send({ name: 'x' });

      expect(forbidden.status).toBe(403);
      expect(wrongDay.status).toBe(404);
    });
  });

  describe('PATCH /api/activities/:id', () => {
    it('changes only the fields that are sent', async () => {
      const { activity } = await withMuseum();

      const response = await editActivity(activity.id, {
        name: 'Egyptian Museum',
        cost: 2500,
      }).expect(200);

      expect(response.body.days[0].activities[0]).toEqual({
        ...activity,
        name: 'Egyptian Museum',
        cost: 2500,
      });
      expect(response.body.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 2500, currency: FIXTURE_CURRENCY },
      ]);
    });

    it('removes the description and the time when they are sent empty', async () => {
      const { activity } = await withMuseum();

      const response = await editActivity(activity.id, {
        description: '',
        time: '',
      }).expect(200);

      expect(response.body.days[0].activities[0]).toEqual({
        id: activity.id,
        name: 'Museum',
        cost: 2000,
        currency: FIXTURE_CURRENCY,
        images: [],
      });
    });

    it('refuses null with 400 and changes nothing', async () => {
      const { itinerary, activity } = await withMuseum();

      const response = await editActivity(activity.id, {
        name: null,
        cost: null,
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'cost', messages: ['cost must not be null'] },
        { field: 'name', messages: ['name must not be null'] },
      ]);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.days[0].activities[0].name).toBe('Museum');
    });

    it('refuses a currency on an activity that has no cost', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const added = await addActivity(itinerary, 0, { name: 'Walk' }).expect(
        201,
      );

      const response = await editActivity(added.body.days[0].activities[0].id, {
        currency: FIXTURE_CURRENCY,
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'cost and currency go together: send both, or neither',
      );
    });

    it('answers 403 to another user and changes nothing', async () => {
      const { itinerary, activity } = await withMuseum();

      const response = await editActivity(
        activity.id,
        { name: 'Mine now' },
        otherUser,
      );

      expect(response.status).toBe(403);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.days[0].activities[0].name).toBe('Museum');
    });

    it('answers 404 for an id that is no activity and 400 for a bad id', async () => {
      const missing = await editActivity(new Types.ObjectId().toString(), {
        name: 'x',
      });
      const badId = await editActivity('not-an-id', { name: 'x' });

      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe('Activity not found');
      expect(badId.status).toBe(400);
    });
  });

  describe('DELETE /api/activities/:id', () => {
    it('removes the activity and its cost from the budget', async () => {
      const { activity } = await withMuseum();

      const response = await deleteActivity(activity.id).expect(200);

      expect(response.body.days[0].activities).toEqual([]);
      expect(response.body.cityGroups[0].budgetSubtotal).toEqual([]);
    });

    it('answers 404 when the activity was already deleted', async () => {
      const { activity } = await withMuseum();

      await deleteActivity(activity.id).expect(200);
      const again = await deleteActivity(activity.id);

      expect(again.status).toBe(404);
    });

    it('answers 403 to another user and deletes nothing', async () => {
      const { itinerary, activity } = await withMuseum();

      const response = await deleteActivity(activity.id, otherUser);

      expect(response.status).toBe(403);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.days[0].activities).toHaveLength(1);
    });
  });

  it('removes the activities of a day when the day is deleted (ITN-07)', async () => {
    const { itinerary, activity } = await withMuseum();

    await fixture
      .http()
      .delete(`/api/itineraries/${itinerary.id}/days/${itinerary.days[0].id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    expect((await editActivity(activity.id, { name: 'x' })).status).toBe(404);
  });

  it('documents the ITN-10 routes in Swagger', async () => {
    const response = await fixture.http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const operations = [
      paths['/api/itineraries/{id}/days/{dayId}/activities'].post,
      paths['/api/activities/{id}'].patch,
      paths['/api/activities/{id}'].delete,
    ];

    for (const operation of operations) {
      expect(operation.tags).toEqual(['Itineraries']);
      expect(operation.description).toMatch(/^ITN-10\. /);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['400', '401', '403', '404', '409']),
      );
    }
  });
});
