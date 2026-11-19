import './support/auth-env';
// fxrates-env runs first for every file (jest-e2e.json); only its values are read here.
import {
  TEST_FXRATES_API_KEY,
  TEST_FXRATES_API_URL,
} from './support/fxrates-env';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { randomInt } from 'node:crypto';
import { ExchangeRate } from './../src/exchange-rates/models/exchange-rate.schema';
import { Country } from './../src/reference/models/country.schema';
import { User } from './../src/users/models/user.schema';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';

/** The name of the test countries, so cleanup never touches real data. */
const COUNTRY_NAME = 'Itinerary budget conversion e2e country';

/**
 * A rate date no real fetch gives, different for every run, so this file
 * deletes only the rate documents it made.
 */
const RATE_DATE = `2${randomInt(100, 999)}-0${randomInt(1, 10)}-1${randomInt(0, 10)}`;

/** What the fake FXRatesAPI answers: EGP 50 per dollar. No GBP rate. */
const RATES = { USD: 1, EGP: 50, EUR: 0.8 };

interface Money {
  amount: number;
  currency: string;
}
interface SummaryBody {
  total: Money[];
  converted: Money | null;
  conversion: {
    currency: string;
    rateDate: string;
    fetchedAt: string;
    missingCurrencies: string[];
  } | null;
  byCategory: { category: string; total: Money[]; converted: Money | null }[];
  byDay: { total: Money[]; converted: Money | null }[];
}

describe('Budget summary in the user currency (e2e, ITN-18)', () => {
  let fixture: ItineraryFixture;
  let countries: Model<Country>;
  let exchangeRates: Model<ExchangeRate>;
  let users: Model<User>;
  const countryCodes: string[] = [];
  let owner: FixtureUser;
  let fetchSpy: jest.SpyInstance;
  /** What the fake API answers next: a body, or an HTTP status for a failure. */
  let apiAnswer: unknown | number = {
    success: true,
    base: 'USD',
    date: `${RATE_DATE}T23:59:00.000Z`,
    rates: RATES,
  };
  const apiCalls: URL[] = [];

  const http = () => fixture.http();

  const summaryOf = async (itineraryId: string, cookie = owner.cookie) => {
    const response = await http()
      .get(`/api/itineraries/${itineraryId}/budget-summary`)
      .set('Cookie', cookie)
      .expect(200);
    return response.body as SummaryBody;
  };
  const addEntry = (
    itineraryId: string,
    dayId: string,
    amount: number,
    currency: string,
  ) =>
    http()
      .post(`/api/itineraries/${itineraryId}/days/${dayId}/budgets`)
      .set('Cookie', owner.cookie)
      .send({ category: 'food', amount, currency })
      .expect(201);
  /**
   * Sets the preferred currency of the owner (ACC-09) in the test database.
   * The profile route itself is tested with ACC-09; this file tests what the
   * summary does with the stored value.
   */
  const prefer = (currency: string | null) =>
    users.updateOne(
      { _id: owner.id },
      currency === null
        ? { $unset: { preferredCurrency: 1 } }
        : { $set: { preferredCurrency: currency } },
    );

  /** A test country, so a currency is supported (ITN-14) and can be preferred. */
  const addCountry = async (currency: string) => {
    for (;;) {
      const code = `X${String.fromCharCode(65 + randomInt(26))}`;
      try {
        await countries.create({ _id: code, name: COUNTRY_NAME, currency });
        countryCodes.push(code);
        return;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
  };

  /** An itinerary with USD 10.00 on day 1 and EGP 250.00 on day 2. */
  const trip = async () => {
    const itinerary = await fixture.createItinerary(owner, [
      fixture.cityA,
      fixture.cityB,
    ]);
    const [first, second] = itinerary.days.map((day) => day.id);
    await addEntry(itinerary.id, first, 1000, FIXTURE_CURRENCY);
    await addEntry(itinerary.id, second, 25000, 'EGP');
    return { itineraryId: itinerary.id, dayIds: [first, second] };
  };

  beforeAll(async () => {
    // The app calls FXRatesAPI with fetch; supertest does not use fetch.
    const realFetch = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin !== TEST_FXRATES_API_URL) return realFetch(input, init);
      apiCalls.push(url);
      return Promise.resolve(
        typeof apiAnswer === 'number'
          ? new Response('{}', { status: apiAnswer })
          : new Response(JSON.stringify(apiAnswer), { status: 200 }),
      );
    });
    fixture = await createItineraryFixture();
    countries = fixture.app.get<Model<Country>>(getModelToken(Country.name));
    exchangeRates = fixture.app.get<Model<ExchangeRate>>(
      getModelToken(ExchangeRate.name),
    );
    users = fixture.app.get<Model<User>>(getModelToken(User.name));
    await addCountry('EGP');
    await addCountry('GBP');
    owner = await fixture.createUser();
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await exchangeRates.deleteOne({ _id: RATE_DATE });
    for (const code of countryCodes) {
      await countries.deleteOne({ _id: code, name: COUNTRY_NAME });
    }
    await fixture.cleanup();
  });

  it('fetches the rates once a day, stores them and converts to USD when no currency is chosen', async () => {
    const { itineraryId } = await trip();

    const summary = await summaryOf(itineraryId);

    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].pathname).toBe('/latest');
    expect(apiCalls[0].searchParams.get('base')).toBe('USD');
    expect(apiCalls[0].searchParams.get('api_key')).toBe(TEST_FXRATES_API_KEY);
    const stored = await exchangeRates.findById(RATE_DATE).lean();
    expect(stored).toMatchObject({ base: 'USD', rates: RATES });

    // USD 10.00 + EGP 250.00 (USD 5.00) = USD 15.00.
    expect(summary.total).toEqual([
      { amount: 25000, currency: 'EGP' },
      { amount: 1000, currency: 'USD' },
    ]);
    expect(summary.converted).toEqual({ amount: 1500, currency: 'USD' });
    expect(summary.conversion).toEqual({
      currency: 'USD',
      rateDate: RATE_DATE,
      fetchedAt: expect.stringMatching(/Z$/),
      missingCurrencies: [],
    });
    expect(summary.byDay.map((day) => day.converted)).toEqual([
      { amount: 1000, currency: 'USD' },
      { amount: 500, currency: 'USD' },
    ]);

    await summaryOf(itineraryId);
    expect(apiCalls).toHaveLength(1);
  });

  it('converts to the preferred currency of the user (ACC-09)', async () => {
    const { itineraryId } = await trip();
    await prefer('EGP');

    const summary = await summaryOf(itineraryId);

    // USD 10.00 is EGP 500.00, plus EGP 250.00.
    expect(summary.converted).toEqual({ amount: 75000, currency: 'EGP' });
    expect(summary.conversion?.currency).toBe('EGP');
    const food = summary.byCategory.find((line) => line.category === 'food');
    expect(food?.converted).toEqual({ amount: 75000, currency: 'EGP' });
    expect(
      summary.byCategory
        .filter((line) => line.category !== 'food')
        .map((line) => line.converted),
    ).toEqual(Array(4).fill({ amount: 0, currency: 'EGP' }));
    await prefer(null);
  });

  it('names a currency without a rate and leaves only the totals that need it unconverted', async () => {
    const { itineraryId, dayIds } = await trip();
    await addEntry(itineraryId, dayIds[1], 999, 'GBP');

    const summary = await summaryOf(itineraryId);

    expect(summary.conversion?.missingCurrencies).toEqual(['GBP']);
    expect(summary.converted).toBeNull();
    expect(summary.byDay.map((day) => day.converted)).toEqual([
      { amount: 1000, currency: 'USD' },
      null,
    ]);
    expect(summary.total).toContainEqual({ amount: 999, currency: 'GBP' });
  });

  it('gives a user whose currency has no rate the totals without conversion', async () => {
    const { itineraryId } = await trip();
    await prefer('GBP');

    const summary = await summaryOf(itineraryId);

    expect(summary.conversion?.missingCurrencies).toEqual(['GBP']);
    expect(summary.converted).toBeNull();
    expect(summary.total).toHaveLength(2);
    await prefer(null);
  });

  it('uses the cached rates when FXRatesAPI fails, and the summary still answers', async () => {
    const { itineraryId } = await trip();
    // The stored day now looks fetched yesterday, so the next read fetches.
    await exchangeRates.updateOne(
      { _id: RATE_DATE },
      { $set: { fetchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    );
    apiAnswer = 500;

    const summary = await summaryOf(itineraryId);

    expect(apiCalls).toHaveLength(2);
    expect(summary.conversion?.rateDate).toBe(RATE_DATE);
    expect(summary.converted).toEqual({ amount: 1500, currency: 'USD' });
    const stored = await exchangeRates.findById(RATE_DATE).lean();
    expect(stored?.rates).toEqual(RATES);
  });

  it('converts every budget amount when the owner opens the itinerary', async () => {
    const { itineraryId, dayIds } = await trip();
    await http()
      .post(`/api/itineraries/${itineraryId}/days/${dayIds[0]}/activities`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Museum', cost: 5000, currency: 'EGP' })
      .expect(201);
    await http()
      .post(`/api/itineraries/${itineraryId}/transport-costs`)
      .set('Cookie', owner.cookie)
      .send({
        dayId: dayIds[1],
        mode: 'train',
        fromCityId: fixture.cityA,
        toCityId: fixture.cityB,
        amount: 2000,
        currency: FIXTURE_CURRENCY,
      })
      .expect(201);
    await prefer('EGP');

    const response = await http()
      .get(`/api/itineraries/${itineraryId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const [first, second] = response.body.days;

    // USD 10.00 = EGP 500.00; EGP stays; USD 20.00 = EGP 1,000.00.
    expect(first.budgetEntries[0].converted).toEqual({
      amount: 50000,
      currency: 'EGP',
    });
    expect(second.budgetEntries[0].converted).toEqual({
      amount: 25000,
      currency: 'EGP',
    });
    expect(first.activities[0].converted).toEqual({
      amount: 5000,
      currency: 'EGP',
    });
    expect(second.transportCosts[0].converted).toEqual({
      amount: 100000,
      currency: 'EGP',
    });
    expect(
      response.body.cityGroups.map(
        (group: { budgetSubtotalConverted: Money | null }) =>
          group.budgetSubtotalConverted,
      ),
    ).toEqual([
      { amount: 55000, currency: 'EGP' },
      { amount: 125000, currency: 'EGP' },
    ]);
    expect(response.body.conversion).toMatchObject({
      currency: 'EGP',
      rateDate: RATE_DATE,
      missingCurrencies: [],
    });
    await prefer(null);
  });

  it('documents the converted totals in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;

    expect(Object.keys(schemas.BudgetSummaryResponseDto.properties)).toEqual([
      'itineraryId',
      'total',
      'converted',
      'conversion',
      'byCategory',
      'byDay',
    ]);
    expect(Object.keys(schemas.BudgetConversionResponseDto.properties)).toEqual(
      ['currency', 'rateDate', 'fetchedAt', 'missingCurrencies'],
    );
    expect(schemas.BudgetCategoryTotalResponseDto.properties).toHaveProperty(
      'converted',
    );
    expect(schemas.BudgetDayTotalResponseDto.properties).toHaveProperty(
      'converted',
    );
  });
});
