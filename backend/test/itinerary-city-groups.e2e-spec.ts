import './support/auth-env';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type DetailBody,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';

interface GroupBody {
  cityId: string;
  firstDayNumber: number;
  lastDayNumber: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  budgetSubtotal: { amount: number; currency: string }[];
}

describe('City groups (e2e, ITN-09)', () => {
  let fixture: ItineraryFixture;
  let owner: FixtureUser;
  let A: string;
  let B: string;

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    owner = await fixture.createUser();
    A = fixture.cityA;
    B = fixture.cityB;
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  const read = async (id: string): Promise<GroupBody[]> => {
    const response = await fixture
      .http()
      .get(`/api/itineraries/${id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    return response.body.cityGroups as GroupBody[];
  };
  const summary = (groups: GroupBody[]) =>
    groups.map((group) => [
      group.cityId,
      group.firstDayNumber,
      group.lastDayNumber,
    ]);

  it('groups consecutive days in the same city with their dates and day count', async () => {
    const itinerary = await fixture.createItinerary(owner, [A, A, B, A]);

    expect(await read(itinerary.id)).toEqual([
      {
        cityId: A,
        firstDayNumber: 1,
        lastDayNumber: 2,
        startDate: '2026-12-20',
        endDate: '2026-12-21',
        dayCount: 2,
        budgetSubtotal: [],
      },
      {
        cityId: B,
        firstDayNumber: 3,
        lastDayNumber: 3,
        startDate: '2026-12-22',
        endDate: '2026-12-22',
        dayCount: 1,
        budgetSubtotal: [],
      },
      {
        cityId: A,
        firstDayNumber: 4,
        lastDayNumber: 4,
        startDate: '2026-12-23',
        endDate: '2026-12-23',
        dayCount: 1,
        budgetSubtotal: [],
      },
    ]);
  });

  it('comes back with every change to the days: add, edit, move and delete', async () => {
    const itinerary: DetailBody = await fixture.createItinerary(owner, [
      A,
      B,
      A,
    ]);
    const [first, middle, last] = itinerary.days;
    const days = `/api/itineraries/${itinerary.id}/days`;

    // Moving the last A next to the first one joins them.
    const moved = await fixture
      .http()
      .patch(`${days}/reorder`)
      .set('Cookie', owner.cookie)
      .send({ dayId: last.id, position: 2 })
      .expect(200);
    expect(summary(moved.body.cityGroups)).toEqual([
      [A, 1, 2],
      [B, 3, 3],
    ]);

    // Changing the B day to A makes one group of three.
    const edited = await fixture
      .http()
      .patch(`${days}/${middle.id}`)
      .set('Cookie', owner.cookie)
      .send({ cityId: A })
      .expect(200);
    expect(summary(edited.body.cityGroups)).toEqual([[A, 1, 3]]);

    // Deleting the first day keeps one group, now two days long.
    const removed = await fixture
      .http()
      .delete(`${days}/${first.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(summary(removed.body.cityGroups)).toEqual([[A, 1, 2]]);

    // A new day in another city starts a new group.
    const added = await fixture
      .http()
      .post(days)
      .set('Cookie', owner.cookie)
      .send({ cityId: B })
      .expect(201);
    expect(summary(added.body.cityGroups)).toEqual([
      [A, 1, 2],
      [B, 3, 3],
    ]);
  });

  it('adds the costs stored in the days of a group to its subtotal', async () => {
    const itinerary = await fixture.createItinerary(owner, [A, A, B]);
    // Activities and transport costs get their own routes in ITN-10 and
    // ITN-16; here they are written straight into the test database.
    await fixture.itineraries.updateOne(
      { _id: itinerary.id },
      {
        $set: {
          'days.0.activities': [
            { name: 'Museum', cost: 2000, currency: FIXTURE_CURRENCY },
          ],
          'days.1.transportCosts': [
            {
              mode: 'bus',
              fromCityId: A,
              toCityId: B,
              amount: 500,
              currency: FIXTURE_CURRENCY,
            },
          ],
        },
      },
    );

    const [cityA, cityB] = await read(itinerary.id);

    expect(cityA.budgetSubtotal).toEqual([
      { amount: 2500, currency: FIXTURE_CURRENCY },
    ]);
    expect(cityB.budgetSubtotal).toEqual([]);
  });

  it('has no groups when the itinerary has no days', async () => {
    const itinerary = await fixture.createItinerary(owner);

    expect(await read(itinerary.id)).toEqual([]);
  });

  it('documents the city groups in Swagger', async () => {
    const response = await fixture.http().get('/api/docs-json').expect(200);
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;

    expect(
      Object.keys(schemas.ItineraryDetailResponseDto.properties),
    ).toContain('cityGroups');
    expect(Object.keys(schemas.CityGroupResponseDto.properties)).toEqual([
      'cityId',
      'firstDayNumber',
      'lastDayNumber',
      'startDate',
      'endDate',
      'dayCount',
      'budgetSubtotal',
    ]);
  });
});
