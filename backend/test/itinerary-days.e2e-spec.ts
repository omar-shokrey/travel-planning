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

describe('Itinerary days (e2e, ITN-07)', () => {
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
