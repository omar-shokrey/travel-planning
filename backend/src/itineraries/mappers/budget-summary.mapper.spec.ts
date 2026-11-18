import { Mongoose, Types } from 'mongoose';
import type { MoneyResponseDto } from '../dto/money-response.dto';
import { BudgetCategory } from '../enums/budget-category.enum';
import {
  BUDGET_SUMMARY_CATEGORIES,
  BudgetSummaryCategory,
} from '../enums/budget-summary-category.enum';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from '../models/itinerary.schema';
import { toBudgetSummaryResponse } from './budget-summary.mapper';
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

/** The totals of a summary line, by category. */
const line = (
  lines: { category: BudgetSummaryCategory; total: MoneyResponseDto[] }[],
  category: BudgetSummaryCategory,
) => lines.find((candidate) => candidate.category === category)?.total;

describe('toBudgetSummaryResponse (ITN-14)', () => {
  it('adds up every currency on its own, sorted by currency code', () => {
    const summary = toBudgetSummaryResponse(trip());

    expect(summary.total).toEqual([
      { amount: 4000, currency: 'AED' },
      { amount: 56000, currency: 'EGP' },
      { amount: 31500, currency: 'USD' },
    ]);
  });

  it('always has the five lines in a fixed order, and counts each cost on its line', () => {
    const { byCategory } = toBudgetSummaryResponse(trip());

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
    const { byCategory } = toBudgetSummaryResponse(trip());

    expect(line(byCategory, BudgetSummaryCategory.Activities)).toEqual([
      { amount: 3000, currency: 'EGP' },
    ]);
  });

  it('counts transport costs (ITN-16) under intercity_transport', () => {
    const { byCategory } = toBudgetSummaryResponse(trip());

    expect(line(byCategory, BudgetSummaryCategory.IntercityTransport)).toEqual([
      { amount: 30000, currency: 'USD' },
    ]);
  });

  it('lists every day in order with its id, number, date, city, total and five lines', () => {
    const itinerary = trip();
    const { byDay } = toBudgetSummaryResponse(itinerary);

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
    const summary = toBudgetSummaryResponse(itinerary);
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

  it('gives an empty itinerary empty totals, five empty lines and no days', () => {
    const itinerary = stored();
    const summary = toBudgetSummaryResponse(itinerary);

    expect(summary).toEqual({
      itineraryId: itinerary._id.toString(),
      total: [],
      byCategory: BUDGET_SUMMARY_CATEGORIES.map((category) => ({
        category,
        total: [],
      })),
      byDay: [],
    });
  });

  it('gives a day without costs an empty total and five empty lines', () => {
    const summary = toBudgetSummaryResponse(stored([{ cityId: 'cairo' }]));

    expect(summary.byDay[0].total).toEqual([]);
    expect(
      summary.byDay[0].byCategory.every((entry) => entry.total.length === 0),
    ).toBe(true);
  });
});
