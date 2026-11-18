import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { randomInt, randomUUID } from 'node:crypto';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import {
  BUDGET_ENTRIES_PER_DAY_MAX,
  MONEY_AMOUNT_MAX,
} from './../src/itineraries/itineraries.constants';
import { Country } from './../src/reference/models/country.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';
import { sessionCookieFor } from './support/session-cookie';

/** The name of the second test country, so cleanup never touches real data. */
const SECOND_COUNTRY_NAME = 'Itinerary budgets e2e country';
/** A second supported currency, from that country. */
const SECOND_CURRENCY = 'EUR';

interface Money {
  amount: number;
  currency: string;
}
interface EntryBody {
  id: string;
  category: string;
  amount: number;
  currency: string;
}
interface DayBody {
  id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  budgetEntries: EntryBody[];
}
interface DetailBody {
  id: string;
  days: DayBody[];
  cityGroups: { budgetSubtotal: Money[] }[];
}
interface CategoryLine {
  category: string;
  total: Money[];
}
interface SummaryBody {
  itineraryId: string;
  total: Money[];
  byCategory: CategoryLine[];
  byDay: {
    dayId: string;
    dayNumber: number;
    date: string;
    cityId: string;
    total: Money[];
    byCategory: CategoryLine[];
  }[];
}

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  responses: Record<string, unknown>;
}

describe('Budget entries and totals (e2e, ITN-14)', () => {
  let fixture: ItineraryFixture;
  let users: Model<User>;
  let countries: Model<Country>;
  let secondCountry = '';
  let owner: FixtureUser;
  let other: FixtureUser;
  const staff: { id: string; cookie: string; role: Role }[] = [];

  const http = () => fixture.http();

  const addEntry = (
    itineraryId: string,
    dayId: string,
    body: Record<string, unknown>,
    cookie: string | undefined = owner.cookie,
  ) => {
    const call = http().post(
      `/api/itineraries/${itineraryId}/days/${dayId}/budgets`,
    );
    return (cookie ? call.set('Cookie', cookie) : call).send(body);
  };
  const editEntry = (
    entryId: string,
    body: Record<string, unknown>,
    cookie: string | undefined = owner.cookie,
  ) => {
    const call = http().patch(`/api/budgets/${entryId}`);
    return (cookie ? call.set('Cookie', cookie) : call).send(body);
  };
  const deleteEntry = (
    entryId: string,
    cookie: string | undefined = owner.cookie,
  ) => {
    const call = http().delete(`/api/budgets/${entryId}`);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const summaryOf = (
    itineraryId: string,
    cookie: string | undefined = owner.cookie,
  ) => {
    const call = http().get(`/api/itineraries/${itineraryId}/budget-summary`);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const line = (lines: CategoryLine[], category: string) =>
    lines.find((candidate) => candidate.category === category)?.total;

  const food = (amount: number, currency = FIXTURE_CURRENCY) => ({
    category: 'food',
    amount,
    currency,
  });

  /** A user made straight in the database, with a session (ACC-06). */
  const createStaff = async (role: Role) => {
    const user = await users.create({
      name: `ITN-14 ${role}`,
      email: `itn14-${role}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      }),
    });
    const id = user._id.toString();
    staff.push({ id, role, cookie: await sessionCookieFor(fixture.app, id) });
    return staff[staff.length - 1].cookie;
  };

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    users = fixture.app.get<Model<User>>(getModelToken(User.name));
    countries = fixture.app.get<Model<Country>>(getModelToken(Country.name));
    // A second country, so a second currency is supported. A code taken by
    // another test file in between is tried again, never shared.
    for (;;) {
      const code = `X${String.fromCharCode(65 + randomInt(26))}`;
      try {
        await countries.create({
          _id: code,
          name: SECOND_COUNTRY_NAME,
          currency: SECOND_CURRENCY,
        });
        secondCountry = code;
        break;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    owner = await fixture.createUser();
    other = await fixture.createUser();
    await createStaff(Role.Admin);
    await createStaff(Role.HotelModerator);
  });

  afterAll(async () => {
    for (const { id } of staff) {
      await deleteSessionsOf(fixture.app, id);
      await users.deleteOne({ _id: id });
    }
    await countries.deleteOne({
      _id: secondCountry,
      name: SECOND_COUNTRY_NAME,
    });
    await fixture.cleanup();
  });

  describe('add, edit and delete', () => {
    it('adds an entry, edits it and deletes it, and the day lists it meanwhile', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const dayId = itinerary.days[0].id;

      const added = await addEntry(itinerary.id, dayId, food(4500));
      expect(added.status).toBe(201);
      const [entry] = (added.body as DetailBody).days[0].budgetEntries;
      expect(entry).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        category: 'food',
        amount: 4500,
        currency: FIXTURE_CURRENCY,
      });

      const edited = await editEntry(entry.id, {
        category: 'accommodation',
        amount: 90000,
        currency: SECOND_CURRENCY,
      });
      expect(edited.status).toBe(200);
      expect((edited.body as DetailBody).days[0].budgetEntries).toEqual([
        {
          id: entry.id,
          category: 'accommodation',
          amount: 90000,
          currency: SECOND_CURRENCY,
        },
      ]);

      const onlyAmount = await editEntry(entry.id, { amount: 1 });
      expect(onlyAmount.body.days[0].budgetEntries[0]).toMatchObject({
        category: 'accommodation',
        amount: 1,
      });
      const empty = await editEntry(entry.id, {});
      expect(empty.status).toBe(200);
      expect(empty.body.days[0].budgetEntries[0].amount).toBe(1);

      const read = await http()
        .get(`/api/itineraries/${itinerary.id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect((read.body as DetailBody).days[0].budgetEntries).toHaveLength(1);

      const deleted = await deleteEntry(entry.id);
      expect(deleted.status).toBe(200);
      expect((deleted.body as DetailBody).days[0].budgetEntries).toEqual([]);
      await deleteEntry(entry.id).expect(404);
    });

    it('counts the entries in the city-group subtotal (ITN-09)', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const added = await addEntry(
        itinerary.id,
        itinerary.days[0].id,
        food(700),
      );

      expect((added.body as DetailBody).cityGroups[0].budgetSubtotal).toEqual([
        { amount: 700, currency: FIXTURE_CURRENCY },
      ]);
    });

    it.each([
      ['a negative amount', food(-1), 'amount'],
      ['a fraction', food(12.5), 'amount'],
      ['1e300', food(1e300), 'amount'],
      ['an amount above the limit', food(MONEY_AMOUNT_MAX + 1), 'amount'],
      [
        'intercity transport as a category',
        { ...food(1), category: 'intercity_transport' },
        'category',
      ],
      ['no currency', { category: 'food', amount: 1 }, 'currency'],
      ['an unknown field', { ...food(1), ownerId: 'x' }, 'ownerId'],
    ])(
      'refuses %s with 400 and stores nothing',
      async (_label, body, field) => {
        const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

        const response = await addEntry(
          itinerary.id,
          itinerary.days[0].id,
          body,
        );

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(field);
        const stored = await fixture.itineraries.findById(itinerary.id).lean();
        expect(stored?.days[0].budgetEntries).toEqual([]);
      },
    );

    it('refuses a currency that is not supported with 400', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const response = await addEntry(
        itinerary.id,
        itinerary.days[0].id,
        food(1, 'QQQ'),
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Unsupported currency: QQQ');
    });

    it('refuses null in an edit with 400 and changes nothing', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const added = await addEntry(itinerary.id, itinerary.days[0].id, food(5));
      const entryId = added.body.days[0].budgetEntries[0].id as string;

      const response = await editEntry(entryId, { amount: null });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'amount', messages: ['amount must not be null'] },
      ]);
      const read = await http()
        .get(`/api/itineraries/${itinerary.id}`)
        .set('Cookie', owner.cookie);
      expect(read.body.days[0].budgetEntries[0].amount).toBe(5);
    });
  });

  describe('who may use the budget routes (400, 401, 403, 404)', () => {
    let itineraryId: string;
    let dayId: string;
    let entryId: string;

    beforeAll(async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      itineraryId = itinerary.id;
      dayId = itinerary.days[0].id;
      const added = await addEntry(itineraryId, dayId, food(100));
      entryId = added.body.days[0].budgetEntries[0].id as string;
    });

    /** The cookie of each caller; a guest sends none (an empty string). */
    const cookieOf = (who: string): string => {
      if (who === 'guest') return '';
      if (who === 'other') return other.cookie;
      const role = who === 'admin' ? Role.Admin : Role.HotelModerator;
      const user = staff.find((candidate) => candidate.role === role);
      if (!user) throw new Error(`No ${role} was created`);
      return user.cookie;
    };

    it.each([
      ['a guest', 401, 'guest'],
      ['another user', 403, 'other'],
      ['an administrator', 403, 'admin'],
      ['a moderator', 403, 'moderator'],
    ])(
      '%s gets %p on every route and nothing changes',
      async (_label, status, who) => {
        const cookie = cookieOf(who);

        const responses = await Promise.all([
          addEntry(itineraryId, dayId, food(1), cookie),
          editEntry(entryId, { amount: 999 }, cookie),
          deleteEntry(entryId, cookie),
          summaryOf(itineraryId, cookie),
        ]);

        for (const response of responses) {
          expect(response.status).toBe(status);
          if (status === 401) {
            expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
          }
        }
        const stored = await fixture.itineraries.findById(itineraryId).lean();
        expect(stored?.days[0].budgetEntries).toEqual([
          expect.objectContaining({ amount: 100 }),
        ]);
      },
    );

    it('answers 400 for ids that are not valid', async () => {
      await addEntry('not-an-id', dayId, food(1)).expect(400);
      await addEntry(itineraryId, 'not-an-id', food(1)).expect(400);
      await editEntry('not-an-id', { amount: 1 }).expect(400);
      await deleteEntry('not-an-id').expect(400);
      await summaryOf('not-an-id').expect(400);
    });

    it('answers 404 for an itinerary, day or entry that does not exist', async () => {
      const missing = new Types.ObjectId().toString();

      expect((await addEntry(missing, dayId, food(1))).status).toBe(404);
      const noDay = await addEntry(itineraryId, missing, food(1));
      expect(noDay.status).toBe(404);
      expect(noDay.body.message).toBe('Day not found');
      const noEntry = await editEntry(missing, { amount: 1 });
      expect(noEntry.status).toBe(404);
      expect(noEntry.body.message).toBe('Budget entry not found');
      await deleteEntry(missing).expect(404);
      await summaryOf(missing).expect(404);
    });

    it('does not let another user read the summary, even of a public itinerary', async () => {
      await http()
        .patch(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200);

      const response = await summaryOf(itineraryId, other.cookie);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        'You can only see the budget of your own itineraries',
      );
      await http()
        .patch(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'private' })
        .expect(200);
    });
  });

  describe(`at most ${BUDGET_ENTRIES_PER_DAY_MAX} entries per day`, () => {
    /** A day with `count` entries, written straight to the test database. */
    const dayWith = async (count: number) => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const dayId = itinerary.days[0].id;
      await fixture.itineraries.updateOne(
        { _id: itinerary.id },
        {
          $push: {
            'days.0.budgetEntries': {
              $each: Array.from({ length: count }, () => food(1)),
            },
          },
        },
      );
      return { itineraryId: itinerary.id, dayId };
    };
    const countOn = async (itineraryId: string) =>
      (await fixture.itineraries.findById(itineraryId).lean())?.days[0]
        .budgetEntries.length;

    it('answers 409 on a full day and stores nothing more', async () => {
      const { itineraryId, dayId } = await dayWith(BUDGET_ENTRIES_PER_DAY_MAX);

      const response = await addEntry(itineraryId, dayId, food(1));

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        `A day has at most ${BUDGET_ENTRIES_PER_DAY_MAX} budget entries`,
      );
      expect(await countOn(itineraryId)).toBe(BUDGET_ENTRIES_PER_DAY_MAX);
    });

    it('two adds at the same moment at the cap: one 201, one 409, never above the cap', async () => {
      const { itineraryId, dayId } = await dayWith(
        BUDGET_ENTRIES_PER_DAY_MAX - 1,
      );

      const responses = await Promise.all([
        addEntry(itineraryId, dayId, food(1)),
        addEntry(itineraryId, dayId, food(2)),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      expect(await countOn(itineraryId)).toBe(BUDGET_ENTRIES_PER_DAY_MAX);
    });
  });

  describe('GET /api/itineraries/:id/budget-summary', () => {
    /** Two days in city A, one in city B, two currencies, every kind of cost. */
    const trip = async () => {
      const itinerary = await fixture.createItinerary(owner, [
        fixture.cityA,
        fixture.cityA,
        fixture.cityB,
      ]);
      const [first, second, third] = itinerary.days.map((day) => day.id);
      await addEntry(itinerary.id, first, food(3000)).expect(201);
      await addEntry(itinerary.id, first, {
        category: 'accommodation',
        amount: 50000,
        currency: FIXTURE_CURRENCY,
      }).expect(201);
      await addEntry(itinerary.id, second, food(1500, SECOND_CURRENCY)).expect(
        201,
      );
      await addEntry(itinerary.id, third, {
        category: 'local_transport',
        amount: 0,
        currency: SECOND_CURRENCY,
      }).expect(201);
      await http()
        .post(`/api/itineraries/${itinerary.id}/days/${first}/activities`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Museum', cost: 2000, currency: FIXTURE_CURRENCY })
        .expect(201);
      await http()
        .post(`/api/itineraries/${itinerary.id}/transport-costs`)
        .set('Cookie', owner.cookie)
        .send({
          dayId: second,
          mode: 'train',
          fromCityId: fixture.cityA,
          toCityId: fixture.cityB,
          amount: 7000,
          currency: SECOND_CURRENCY,
        })
        .expect(201);
      return { itineraryId: itinerary.id, dayIds: [first, second, third] };
    };

    it('totals by category and by day, one amount per currency', async () => {
      const { itineraryId, dayIds } = await trip();

      const response = await summaryOf(itineraryId);

      expect(response.status).toBe(200);
      const summary = response.body as SummaryBody;
      const both = [SECOND_CURRENCY, FIXTURE_CURRENCY].sort();
      expect(summary.itineraryId).toBe(itineraryId);
      expect(summary.total).toEqual(
        both.map((currency) =>
          currency === FIXTURE_CURRENCY
            ? { amount: 55000, currency }
            : { amount: 8500, currency },
        ),
      );
      expect(summary.byCategory.map(({ category }) => category)).toEqual([
        'food',
        'accommodation',
        'local_transport',
        'activities',
        'intercity_transport',
      ]);
      expect(line(summary.byCategory, 'activities')).toEqual([
        { amount: 2000, currency: FIXTURE_CURRENCY },
      ]);
      expect(line(summary.byCategory, 'intercity_transport')).toEqual([
        { amount: 7000, currency: SECOND_CURRENCY },
      ]);
      expect(line(summary.byCategory, 'local_transport')).toEqual([
        { amount: 0, currency: SECOND_CURRENCY },
      ]);
      expect(
        summary.byDay.map(({ dayId, dayNumber, date }) => ({
          dayId,
          dayNumber,
          date,
        })),
      ).toEqual([
        { dayId: dayIds[0], dayNumber: 1, date: '2026-12-20' },
        { dayId: dayIds[1], dayNumber: 2, date: '2026-12-21' },
        { dayId: dayIds[2], dayNumber: 3, date: '2026-12-22' },
      ]);
      expect(summary.byDay[0].total).toEqual([
        { amount: 55000, currency: FIXTURE_CURRENCY },
      ]);
      expect(line(summary.byDay[1].byCategory, 'intercity_transport')).toEqual([
        { amount: 7000, currency: SECOND_CURRENCY },
      ]);
    });

    it('agrees with the city-group subtotals of the itinerary', async () => {
      const { itineraryId } = await trip();

      const summary = (await summaryOf(itineraryId)).body as SummaryBody;
      const detail = (
        await http()
          .get(`/api/itineraries/${itineraryId}`)
          .set('Cookie', owner.cookie)
      ).body as DetailBody;

      const add = (totals: Money[][]) => {
        const sums = new Map<string, number>();
        for (const { amount, currency } of totals.flat()) {
          sums.set(currency, (sums.get(currency) ?? 0) + amount);
        }
        return [...sums.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, amount]) => ({ amount, currency }));
      };
      expect(
        add(detail.cityGroups.map((group) => group.budgetSubtotal)),
      ).toEqual(summary.total);
      expect(add(summary.byDay.map((day) => day.total))).toEqual(summary.total);
    });

    it('a day deleted (ITN-07) leaves the summary with its entries, and a day moved (ITN-08) renumbers it', async () => {
      const { itineraryId, dayIds } = await trip();

      const moved = await http()
        .patch(`/api/itineraries/${itineraryId}/days/reorder`)
        .set('Cookie', owner.cookie)
        .send({ dayId: dayIds[2], position: 1 })
        .expect(200);
      expect(moved.body.days[0].id).toBe(dayIds[2]);
      const afterMove = (await summaryOf(itineraryId)).body as SummaryBody;
      expect(afterMove.byDay.map((day) => day.dayId)).toEqual([
        dayIds[2],
        dayIds[0],
        dayIds[1],
      ]);
      expect(afterMove.byDay[1]).toMatchObject({
        dayNumber: 2,
        date: '2026-12-21',
        total: [{ amount: 55000, currency: FIXTURE_CURRENCY }],
      });

      await http()
        .delete(`/api/itineraries/${itineraryId}/days/${dayIds[0]}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      const afterDelete = (await summaryOf(itineraryId)).body as SummaryBody;
      expect(afterDelete.total).toEqual([
        { amount: 8500, currency: SECOND_CURRENCY },
      ]);
      expect(afterDelete.byDay).toHaveLength(2);
      const stored = await fixture.itineraries.findById(itineraryId).lean();
      expect(
        stored?.days.flatMap((day) =>
          day.budgetEntries.map((entry) => entry.amount),
        ),
      ).toEqual([0, 1500]);
    });

    it('gives an itinerary without costs empty totals and five empty lines', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const summary = (await summaryOf(itinerary.id)).body as SummaryBody;

      expect(summary.total).toEqual([]);
      expect(summary.byCategory).toHaveLength(5);
      expect(
        summary.byCategory.every((entry) => entry.total.length === 0),
      ).toBe(true);
      expect(summary.byDay[0].total).toEqual([]);
    });
  });

  describe('public view and clone (ITN-21)', () => {
    it('the public view shows the entries and a clone copies them with new ids', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
      const added = await addEntry(
        itinerary.id,
        itinerary.days[0].id,
        food(1234),
      );
      const original = added.body.days[0].budgetEntries[0] as EntryBody;
      await http()
        .patch(`/api/itineraries/${itinerary.id}`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200);

      const view = await http()
        .get(`/api/itineraries/public/${itinerary.id}`)
        .expect(200);
      expect(view.body.days[0].budgetEntries).toEqual([original]);

      const cloned = await http()
        .post(`/api/itineraries/${itinerary.id}/clone`)
        .set('Cookie', other.cookie)
        .expect(201);
      const [copy] = cloned.body.days[0].budgetEntries as EntryBody[];
      expect(copy).toEqual({ ...original, id: expect.any(String) });
      expect(copy.id).not.toBe(original.id);

      // The clone's owner can read its summary and edit its entry; the
      // original stays as it was.
      const cloneSummary = await summaryOf(cloned.body.id, other.cookie);
      expect(cloneSummary.status).toBe(200);
      expect(cloneSummary.body.total).toEqual([
        { amount: 1234, currency: FIXTURE_CURRENCY },
      ]);
      await editEntry(copy.id, { amount: 1 }, other.cookie).expect(200);
      expect((await summaryOf(itinerary.id)).body.total).toEqual([
        { amount: 1234, currency: FIXTURE_CURRENCY },
      ]);
    });
  });

  it('documents the ITN-14 routes in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const operations = [
      paths['/api/itineraries/{id}/days/{dayId}/budgets'].post,
      paths['/api/budgets/{id}'].patch,
      paths['/api/budgets/{id}'].delete,
      paths['/api/itineraries/{id}/budget-summary'].get,
    ];
    for (const operation of operations) {
      expect(operation.tags).toEqual(['Itineraries']);
      expect(operation.description).toMatch(/^ITN-14\. /);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['400', '401', '403', '404']),
      );
    }
    expect(Object.keys(operations[0].responses)).toEqual(
      expect.arrayContaining(['201', '409']),
    );
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, { enum?: string[]; maximum?: number }> }
    >;
    expect(schemas.CreateBudgetEntryDto.properties.category.enum).toEqual([
      'food',
      'accommodation',
      'local_transport',
      'activities',
    ]);
    expect(schemas.CreateBudgetEntryDto.properties.amount.maximum).toBe(
      MONEY_AMOUNT_MAX,
    );
    expect(Object.keys(schemas.BudgetSummaryResponseDto.properties)).toEqual([
      'itineraryId',
      'total',
      'byCategory',
      'byDay',
    ]);
  });
});
