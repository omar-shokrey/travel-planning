import { Mongoose, Types } from 'mongoose';
import type { MoneyResponseDto } from '../dto/money-response.dto';
import { BudgetCategory } from '../enums/budget-category.enum';
import { LinkedBookingType } from '../enums/linked-booking-type.enum';
import {
  BUDGET_SUMMARY_CATEGORIES,
  BudgetSummaryCategory,
} from '../enums/budget-summary-category.enum';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from '../models/itinerary.schema';
import {
  type SummaryConversion,
  toBudgetSummaryResponse,
} from './budget-summary.mapper';
import { toCityGroups, totalPerCurrency } from './itinerary.mapper';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const stored = (days: Record<string, unknown>[] = []): ItineraryDocument =>
  new ItineraryModel({
    ownerId: new Types.ObjectId(),
    title: 'Egypt and Dubai',
    countries: ['EG', 'AE'],
    startDate: '2026-12-20',
    dayCount: days.length,
    days,
  }) as ItineraryDocument;

const entry = (category: BudgetCategory, amount: number, currency = 'EGP') => ({
  category,
  amount,
  currency,
});

/** Three days, two cities, two currencies, every kind of cost. */
const trip = () =>
  stored([
    {
      cityId: 'cairo',
      activities: [
        { name: 'Museum', cost: 2000, currency: 'EGP' },
        { name: 'Walk' },
      ],
      budgetEntries: [
        entry(BudgetCategory.Food, 3000),
        entry(BudgetCategory.Accommodation, 50000),
        entry(BudgetCategory.Activities, 1000),
      ],
    },
    {
      cityId: 'cairo',
      budgetEntries: [
        entry(BudgetCategory.LocalTransport, 0),
        entry(BudgetCategory.Food, 1500, 'USD'),
      ],
      transportCosts: [
        {
          mode: 'flight',
          fromCityId: 'cairo',
          toCityId: 'dubai',
          amount: 30000,
          currency: 'USD',
        },
      ],
    },
    {
      cityId: 'dubai',
      budgetEntries: [entry(BudgetCategory.Food, 4000, 'AED')],
    },
  ]);

/** No exchange rates were ever fetched (ITN-18): nothing is converted. */
const NO_RATES: SummaryConversion = { currency: 'USD', rates: null };

/** Dollar rates of one day: EGP 50, AED 3.6725, JPY 150 per dollar. */
const RATES = {
  rateDate: '2026-11-18',
  fetchedAt: new Date('2026-11-19T06:00:00.000Z'),
  rates: { USD: 1, EGP: 50, AED: 3.6725, JPY: 150 },
};

/** The totals of a summary line, by category. */
const line = (
  lines: { category: BudgetSummaryCategory; total: MoneyResponseDto[] }[],
  category: BudgetSummaryCategory,
) => lines.find((candidate) => candidate.category === category)?.total;

describe('toBudgetSummaryResponse (ITN-14)', () => {
  it('adds up every currency on its own, sorted by currency code', () => {
    const summary = toBudgetSummaryResponse(trip(), NO_RATES);

    expect(summary.total).toEqual([
      { amount: 4000, currency: 'AED' },
      { amount: 56000, currency: 'EGP' },
      { amount: 31500, currency: 'USD' },
    ]);
  });

  it('always has the five lines in a fixed order, and counts each cost on its line', () => {
    const { byCategory } = toBudgetSummaryResponse(trip(), NO_RATES);

    expect(byCategory.map(({ category }) => category)).toEqual([
      'food',
      'accommodation',
      'local_transport',
      'activities',
      'intercity_transport',
    ]);
    expect(line(byCategory, BudgetSummaryCategory.Food)).toEqual([
      { amount: 4000, currency: 'AED' },
      { amount: 3000, currency: 'EGP' },
      { amount: 1500, currency: 'USD' },
    ]);
    expect(line(byCategory, BudgetSummaryCategory.Accommodation)).toEqual([
      { amount: 50000, currency: 'EGP' },
    ]);
    // A zero-amount entry still shows its currency, with 0.
    expect(line(byCategory, BudgetSummaryCategory.LocalTransport)).toEqual([
      { amount: 0, currency: 'EGP' },
    ]);
  });

  it('counts activity costs (ITN-10) under activities, with the activities entries', () => {
    const { byCategory } = toBudgetSummaryResponse(trip(), NO_RATES);

    expect(line(byCategory, BudgetSummaryCategory.Activities)).toEqual([
      { amount: 3000, currency: 'EGP' },
    ]);
  });

  it('counts transport costs (ITN-16) under intercity_transport', () => {
    const { byCategory } = toBudgetSummaryResponse(trip(), NO_RATES);

    expect(line(byCategory, BudgetSummaryCategory.IntercityTransport)).toEqual([
      { amount: 30000, currency: 'USD' },
    ]);
  });

  it('lists every day in order with its id, number, date, city, total and five lines', () => {
    const itinerary = trip();
    const { byDay } = toBudgetSummaryResponse(itinerary, NO_RATES);

    expect(
      byDay.map(({ dayId, dayNumber, date, cityId }) => ({
        dayId,
        dayNumber,
        date,
        cityId,
      })),
    ).toEqual([
      {
        dayId: itinerary.days[0]._id.toString(),
        dayNumber: 1,
        date: '2026-12-20',
        cityId: 'cairo',
      },
      {
        dayId: itinerary.days[1]._id.toString(),
        dayNumber: 2,
        date: '2026-12-21',
        cityId: 'cairo',
      },
      {
        dayId: itinerary.days[2]._id.toString(),
        dayNumber: 3,
        date: '2026-12-22',
        cityId: 'dubai',
      },
    ]);
    expect(byDay[1].total).toEqual([
      { amount: 0, currency: 'EGP' },
      { amount: 31500, currency: 'USD' },
    ]);
    expect(byDay[1].byCategory).toHaveLength(5);
    expect(line(byDay[2].byCategory, BudgetSummaryCategory.Food)).toEqual([
      { amount: 4000, currency: 'AED' },
    ]);
  });

  it('total = the sum of the days = the sum of the categories = the sum of the city-group subtotals', () => {
    const itinerary = trip();
    const summary = toBudgetSummaryResponse(itinerary, NO_RATES);
    const sumOf = (totals: MoneyResponseDto[][]) =>
      totalPerCurrency(totals.flat());

    expect(sumOf(summary.byDay.map((day) => day.total))).toEqual(summary.total);
    expect(sumOf(summary.byCategory.map((entry) => entry.total))).toEqual(
      summary.total,
    );
    expect(
      sumOf(
        toCityGroups(itinerary.days, itinerary.startDate).map(
          (group) => group.budgetSubtotal,
        ),
      ),
    ).toEqual(summary.total);
    // Each day's five lines add up to that day's total too.
    for (const day of summary.byDay) {
      expect(sumOf(day.byCategory.map((entry) => entry.total))).toEqual(
        day.total,
      );
    }
  });

  it('counts linked bookings (ITN-27) on their line, and every total still agrees', () => {
    const itinerary = trip();
    itinerary.days[1].linkedBookings.push({
      bookingType: LinkedBookingType.Flight,
      bookingId: new Types.ObjectId(),
      reference: 'FB-7KQ2MX',
      amount: 52000,
      currency: 'USD',
    } as never);
    itinerary.days[2].linkedBookings.push({
      bookingType: LinkedBookingType.Hotel,
      bookingId: new Types.ObjectId(),
      reference: 'HB-3PRT9W',
      amount: 37500,
      currency: 'USD',
    } as never);
    const before = toBudgetSummaryResponse(trip(), NO_RATES);
    const summary = toBudgetSummaryResponse(itinerary, NO_RATES);
    const sumOf = (totals: MoneyResponseDto[][]) =>
      totalPerCurrency(totals.flat());
    const usd = (totals: MoneyResponseDto[] | undefined) =>
      totals?.find((money) => money.currency === 'USD')?.amount ?? 0;

    expect(
      usd(line(summary.byCategory, BudgetSummaryCategory.IntercityTransport)),
    ).toBe(
      usd(line(before.byCategory, BudgetSummaryCategory.IntercityTransport)) +
        52000,
    );
    expect(
      usd(line(summary.byCategory, BudgetSummaryCategory.Accommodation)),
    ).toBe(
      usd(line(before.byCategory, BudgetSummaryCategory.Accommodation)) + 37500,
    );
    expect(usd(summary.total)).toBe(usd(before.total) + 52000 + 37500);
    expect(summary.byCategory).toHaveLength(5);
    expect(sumOf(summary.byDay.map((day) => day.total))).toEqual(summary.total);
    expect(sumOf(summary.byCategory.map((entry) => entry.total))).toEqual(
      summary.total,
    );
    expect(
      sumOf(
        toCityGroups(itinerary.days, itinerary.startDate).map(
          (group) => group.budgetSubtotal,
        ),
      ),
    ).toEqual(summary.total);
    for (const day of summary.byDay) {
      expect(sumOf(day.byCategory.map((entry) => entry.total))).toEqual(
        day.total,
      );
    }
  });

  it('gives an empty itinerary empty totals, five empty lines and no days', () => {
    const itinerary = stored();
    const summary = toBudgetSummaryResponse(itinerary, NO_RATES);

    expect(summary).toEqual({
      itineraryId: itinerary._id.toString(),
      total: [],
      converted: null,
      conversion: null,
      byCategory: BUDGET_SUMMARY_CATEGORIES.map((category) => ({
        category,
        total: [],
        converted: null,
      })),
      byDay: [],
    });
  });

  it('gives a day without costs an empty total and five empty lines', () => {
    const summary = toBudgetSummaryResponse(
      stored([{ cityId: 'cairo' }]),
      NO_RATES,
    );

    expect(summary.byDay[0].total).toEqual([]);
    expect(
      summary.byDay[0].byCategory.every((entry) => entry.total.length === 0),
    ).toBe(true);
  });
});

describe('toBudgetSummaryResponse, converted to the user currency (ITN-18)', () => {
  it('converts every currency to the user currency and adds them up', () => {
    const summary = toBudgetSummaryResponse(trip(), {
      currency: 'EGP',
      rates: RATES,
    });

    // EGP 560.00 stays; USD 315.00 x 50 = EGP 15,750.00;
    // AED 40.00 x 50 / 3.6725 = EGP 544.588... rounded to 544.59.
    expect(summary.total).toEqual([
      { amount: 4000, currency: 'AED' },
      { amount: 56000, currency: 'EGP' },
      { amount: 31500, currency: 'USD' },
    ]);
    expect(summary.converted).toEqual({
      amount: 56000 + 1575000 + 54459,
      currency: 'EGP',
    });
    expect(summary.conversion).toEqual({
      currency: 'EGP',
      rateDate: '2026-11-18',
      fetchedAt: '2026-11-19T06:00:00.000Z',
      missingCurrencies: [],
    });
  });

  it('converts each line and each day on its own', () => {
    const summary = toBudgetSummaryResponse(trip(), {
      currency: 'EGP',
      rates: RATES,
    });

    const food = summary.byCategory.find(
      (entry) => entry.category === BudgetSummaryCategory.Food,
    );
    // EGP 30.00 + USD 15.00 (EGP 750.00) + AED 40.00 (EGP 544.59).
    expect(food?.converted).toEqual({
      amount: 3000 + 75000 + 54459,
      currency: 'EGP',
    });
    expect(summary.byDay.map((day) => day.converted)).toEqual([
      { amount: 56000, currency: 'EGP' },
      { amount: 1575000, currency: 'EGP' },
      { amount: 54459, currency: 'EGP' },
    ]);
    expect(
      summary.byDay[2].byCategory.map((entry) => entry.converted?.amount),
    ).toEqual([54459, 0, 0, 0, 0]);
  });

  it('uses the decimal places of each currency (JPY has none)', () => {
    const summary = toBudgetSummaryResponse(trip(), {
      currency: 'JPY',
      rates: RATES,
    });

    // EGP 560.00 = JPY 1,680; USD 315.00 = JPY 47,250;
    // AED 40.00 = JPY 1,633.76, rounded to 1,634.
    expect(summary.converted).toEqual({
      amount: 1680 + 47250 + 1634,
      currency: 'JPY',
    });
  });

  it('gives a total with nothing in it a converted zero', () => {
    const summary = toBudgetSummaryResponse(stored([{ cityId: 'cairo' }]), {
      currency: 'EGP',
      rates: RATES,
    });

    expect(summary.converted).toEqual({ amount: 0, currency: 'EGP' });
    expect(summary.byDay[0].converted).toEqual({ amount: 0, currency: 'EGP' });
  });

  it('leaves out a total that needs a missing rate and names the currency', () => {
    const summary = toBudgetSummaryResponse(trip(), {
      currency: 'EGP',
      rates: { ...RATES, rates: { USD: 1, EGP: 50 } },
    });

    expect(summary.conversion?.missingCurrencies).toEqual(['AED']);
    expect(summary.converted).toBeNull();
    // The first two days have no AED, so they are still converted.
    expect(summary.byDay.map((day) => day.converted?.amount ?? null)).toEqual([
      56000,
      1575000,
      null,
    ]);
  });

  it('converts nothing when the user currency has no rate', () => {
    const summary = toBudgetSummaryResponse(trip(), {
      currency: 'SAR',
      rates: RATES,
    });

    expect(summary.conversion?.missingCurrencies).toEqual(['SAR']);
    expect(summary.converted).toBeNull();
    expect(summary.byDay.every((day) => day.converted === null)).toBe(true);
  });

  it('converts nothing without rates, and keeps the per-currency totals', () => {
    const withRates = toBudgetSummaryResponse(trip(), {
      currency: 'EGP',
      rates: RATES,
    });
    const without = toBudgetSummaryResponse(trip(), {
      currency: 'EGP',
      rates: null,
    });

    expect(without.conversion).toBeNull();
    expect(without.converted).toBeNull();
    expect(without.byCategory.every((entry) => entry.converted === null)).toBe(
      true,
    );
    expect(without.total).toEqual(withRates.total);
    expect(without.byDay.map((day) => day.total)).toEqual(
      withRates.byDay.map((day) => day.total),
    );
  });
});
