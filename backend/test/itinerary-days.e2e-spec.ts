import './support/auth-env';
import { Types } from 'mongoose';
import {
  createItineraryFixture,
  type DetailBody,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  responses: Record<string, unknown>;
}

describe('Itinerary days (e2e, ITN-07, ITN-08)', () => {
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

  /** An itinerary of the owner with three days: A, A, B. */
  const threeDays = (): Promise<DetailBody> =>
    fixture.createItinerary(owner, [
      fixture.cityA,
      fixture.cityA,
      fixture.cityB,
    ]);

  describe('DELETE /api/itineraries/:id/days/:dayId', () => {
    const removeDay = (id: string, dayId: string, user = owner) =>
      fixture
        .http()
        .delete(`/api/itineraries/${id}/days/${dayId}`)
        .set('Cookie', user.cookie);

    it('removes the day and renumbers and redates the days after it', async () => {
      const itinerary = await threeDays();
      const [first, second, third] = itinerary.days;

      const response = await removeDay(itinerary.id, first.id).expect(200);

      expect(response.body.dayCount).toBe(2);
      expect(response.body.days).toEqual([
        { ...second, dayNumber: 1, date: '2026-12-20' },
        { ...third, dayNumber: 2, date: '2026-12-21' },
      ]);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.dayCount).toBe(2);
      expect(stored?.days.map((day) => day._id.toString())).toEqual([
        second.id,
        third.id,
      ]);
    });

    it('removes the last remaining day, leaving an empty itinerary', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const response = await removeDay(
        itinerary.id,
        itinerary.days[0].id,
      ).expect(200);

      expect(response.body).toMatchObject({ dayCount: 0, days: [] });
    });

    it('answers 404 for a day already deleted, and the count stays right', async () => {
      const itinerary = await threeDays();
      const dayId = itinerary.days[1].id;

      await removeDay(itinerary.id, dayId).expect(200);
      const again = await removeDay(itinerary.id, dayId);

      expect(again.status).toBe(404);
      expect(again.body.message).toBe('Day not found');
      expect(
        (await fixture.itineraries.findById(itinerary.id).lean())?.dayCount,
      ).toBe(2);
    });

    it('keeps the count right when the same day is deleted twice at once', async () => {
      const itinerary = await threeDays();
      const dayId = itinerary.days[0].id;

      const statuses = (
        await Promise.all([
          removeDay(itinerary.id, dayId),
          removeDay(itinerary.id, dayId),
        ])
      )
        .map((response) => response.status)
        .sort();

      // The second one finds the day gone (404), or reads before the first
      // one writes and is refused because the itinerary changed (409).
      expect(statuses[0]).toBe(200);
      expect([404, 409]).toContain(statuses[1]);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.dayCount).toBe(2);
      expect(stored?.days).toHaveLength(2);
    });

    it('answers 403 to another user and deletes nothing', async () => {
      const itinerary = await threeDays();

      const response = await removeDay(
        itinerary.id,
        itinerary.days[0].id,
        otherUser,
      );

      expect(response.status).toBe(403);
      expect(
        (await fixture.itineraries.findById(itinerary.id).lean())?.days,
      ).toHaveLength(3);
    });

    it('answers 404 for a missing itinerary and 400 for a bad id', async () => {
      const itinerary = await threeDays();

      const missing = await removeDay(
        new Types.ObjectId().toString(),
        itinerary.days[0].id,
      );
      const badDay = await removeDay(itinerary.id, 'not-an-id');

      expect(missing.status).toBe(404);
      expect(badDay.status).toBe(400);
    });
  });

  describe('PATCH /api/itineraries/:id/days/reorder', () => {
    const moveDay = (id: string, body: Record<string, unknown>, user = owner) =>
      fixture
        .http()
        .patch(`/api/itineraries/${id}/days/reorder`)
        .set('Cookie', user.cookie)
        .send(body);

    it('moves the last day to the front and renumbers and redates every day', async () => {
      const itinerary = await threeDays();
      const [first, second, third] = itinerary.days;

      const response = await moveDay(itinerary.id, {
        dayId: third.id,
        position: 1,
      }).expect(200);

      expect(response.body.days).toEqual([
        { ...third, dayNumber: 1, date: '2026-12-20' },
        { ...first, dayNumber: 2, date: '2026-12-21' },
        { ...second, dayNumber: 3, date: '2026-12-22' },
      ]);
      expect(response.body.dayCount).toBe(3);
    });

    it('keeps the new order when the itinerary is read again', async () => {
      const itinerary = await threeDays();
      const [first, second, third] = itinerary.days;

      await moveDay(itinerary.id, { dayId: first.id, position: 3 }).expect(200);
      const detail = await fixture
        .http()
        .get(`/api/itineraries/${itinerary.id}`)
        .set('Cookie', owner.cookie)
        .expect(200);

      expect((detail.body as DetailBody).days.map((day) => day.id)).toEqual([
        second.id,
        third.id,
        first.id,
      ]);
    });

    it('changes nothing when the day is moved to where it already is', async () => {
      const itinerary = await threeDays();

      const response = await moveDay(itinerary.id, {
        dayId: itinerary.days[1].id,
        position: 2,
      }).expect(200);

      expect(response.body.days).toEqual(itinerary.days);
    });

    it('rejects a position after the last day, and a body that is not valid', async () => {
      const itinerary = await threeDays();
      const dayId = itinerary.days[0].id;

      const tooFar = await moveDay(itinerary.id, { dayId, position: 4 });
      const zero = await moveDay(itinerary.id, { dayId, position: 0 });
      const extra = await moveDay(itinerary.id, {
        dayId,
        position: 2,
        dayNumber: 2,
      });

      expect(tooFar.status).toBe(400);
      expect(tooFar.body.message).toBe(
        'position must be between 1 and 3, the number of days',
      );
      expect(zero.status).toBe(400);
      expect(zero.body.errors).toEqual([
        { field: 'position', messages: expect.any(Array) },
      ]);
      expect(extra.status).toBe(400);
    });

    it('answers 404 for a day of another itinerary and 403 to another user', async () => {
      const itinerary = await threeDays();
      const other = await threeDays();

      const wrongDay = await moveDay(itinerary.id, {
        dayId: other.days[0].id,
        position: 1,
      });
      const forbidden = await moveDay(
        itinerary.id,
        { dayId: itinerary.days[2].id, position: 1 },
        otherUser,
      );

      expect(wrongDay.status).toBe(404);
      expect(forbidden.status).toBe(403);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.days.map((day) => day._id.toString())).toEqual(
        itinerary.days.map((day) => day.id),
      );
    });

    it('never loses a day when a move and a delete happen at the same time', async () => {
      const itinerary = await threeDays();
      const [first, , third] = itinerary.days;

      const [moved, removed] = await Promise.all([
        moveDay(itinerary.id, { dayId: third.id, position: 1 }),
        fixture
          .http()
          .delete(`/api/itineraries/${itinerary.id}/days/${first.id}`)
          .set('Cookie', owner.cookie),
      ]);

      // Each one either applies or answers 409; neither is half applied.
      expect([200, 409]).toContain(moved.status);
      expect([200, 409]).toContain(removed.status);
      const stored = await fixture.itineraries.findById(itinerary.id).lean();
      expect(stored?.dayCount).toBe(stored?.days.length);
      expect(stored?.days).toHaveLength(removed.status === 200 ? 2 : 3);
    });
  });

  it('documents the ITN-08 route in Swagger', async () => {
    const response = await fixture.http().get('/api/docs-json').expect(200);
    const operation = (
      response.body.paths as Record<string, Record<string, SwaggerOperation>>
    )['/api/itineraries/{id}/days/reorder'].patch;

    expect(operation.tags).toEqual(['Itineraries']);
    expect(operation.description).toMatch(/^ITN-08\. /);
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
  });

  it('documents the ITN-07 route in Swagger', async () => {
    const response = await fixture.http().get('/api/docs-json').expect(200);
    const operation = (
      response.body.paths as Record<string, Record<string, SwaggerOperation>>
    )['/api/itineraries/{id}/days/{dayId}'].delete;

    expect(operation.tags).toEqual(['Itineraries']);
    expect(operation.description).toMatch(/^ITN-07\. /);
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
  });
});
