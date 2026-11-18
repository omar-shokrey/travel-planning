import { Mongoose, Types } from 'mongoose';
import { ItineraryModeration } from '../enums/itinerary-moderation.enum';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from '../models/itinerary.schema';
import { BudgetCategory } from '../enums/budget-category.enum';
import {
  dayCosts,
  dayDate,
  toActivityResponse,
  toTransportCostResponse,
  toCityGroups,
  toItineraryDetailResponse,
  toItineraryResponse,
  totalPerCurrency,
} from './itinerary.mapper';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const ownerId = new Types.ObjectId();
const stored = (extra: Record<string, unknown> = {}): ItineraryDocument =>
  new ItineraryModel({
    ownerId,
    title: 'Ten days in Egypt',
    countries: ['EG', 'AE'],
    startDate: '2026-12-20',
    ...extra,
  }) as ItineraryDocument;

describe('toItineraryResponse', () => {
  it('returns the public fields with string ids', () => {
    const itinerary = stored();

    expect(toItineraryResponse(itinerary)).toEqual({
      id: itinerary._id.toString(),
      ownerId: ownerId.toString(),
      title: 'Ten days in Egypt',
      countries: ['EG', 'AE'],
      startDate: '2026-12-20',
      visibility: ItineraryVisibility.Private,
      moderation: ItineraryModeration.Visible,
      dayCount: 0,
    });
  });

  it('shows the owner that an admin hid the itinerary (GEN-10)', () => {
    const itinerary = stored();
    itinerary.moderation = ItineraryModeration.Hidden;

    expect(toItineraryResponse(itinerary).moderation).toBe(
      ItineraryModeration.Hidden,
    );
  });

  it('keeps the start date as a YYYY-MM-DD string', () => {
    expect(toItineraryResponse(stored()).startDate).toBe('2026-12-20');
  });

  it('returns plain values, not Mongoose objects', () => {
    const response = toItineraryResponse(stored());

    expect(typeof response.id).toBe('string');
    expect(typeof response.ownerId).toBe('string');
    expect(Object.getPrototypeOf(response.countries)).toBe(Array.prototype);
  });

  it('leaves out internal fields', () => {
    const response = toItineraryResponse(stored());

    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('authorDeactivated');
  });
});

describe('dayDate', () => {
  it('gives the start date to the first day', () => {
    expect(dayDate('2026-12-20', 0)).toBe('2026-12-20');
  });

  it('adds one calendar day per position', () => {
    expect(dayDate('2026-12-20', 1)).toBe('2026-12-21');
    expect(dayDate('2026-12-20', 59)).toBe('2027-02-17');
  });

  it('crosses the end of a month and of a year', () => {
    expect(dayDate('2026-12-30', 2)).toBe('2027-01-01');
  });

  it('knows leap years', () => {
    expect(dayDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(dayDate('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('is not shifted by a clock change', () => {
    // Clocks go back in Europe and North America around these dates.
    expect(dayDate('2026-10-24', 1)).toBe('2026-10-25');
    expect(dayDate('2026-10-25', 1)).toBe('2026-10-26');
    expect(dayDate('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('toItineraryDetailResponse', () => {
  it('returns the itinerary fields and an empty list when there are no days', () => {
    const itinerary = stored();

    expect(toItineraryDetailResponse(itinerary)).toEqual({
      ...toItineraryResponse(itinerary),
      days: [],
      cityGroups: [],
    });
  });

  it('numbers the days from 1 and derives each date from the start date', () => {
    const itinerary = stored({
      startDate: '2026-12-30',
      days: [
        { cityId: 'cairo', notes: 'Arrive in the evening' },
        { cityId: 'cairo' },
        { cityId: 'dubai' },
      ],
    });

    expect(toItineraryDetailResponse(itinerary).days).toEqual([
      {
        id: itinerary.days[0]._id.toString(),
        dayNumber: 1,
        date: '2026-12-30',
        cityId: 'cairo',
        notes: 'Arrive in the evening',
        activities: [],
        transportCosts: [],
      },
      {
        id: itinerary.days[1]._id.toString(),
        dayNumber: 2,
        date: '2026-12-31',
        cityId: 'cairo',
        activities: [],
        transportCosts: [],
      },
      {
        id: itinerary.days[2]._id.toString(),
        dayNumber: 3,
        date: '2027-01-01',
        cityId: 'dubai',
        activities: [],
        transportCosts: [],
      },
    ]);
  });

  it('leaves out empty notes and the embedded lists of later features', () => {
    const itinerary = stored({ days: [{ cityId: 'cairo', notes: '' }] });
    const [day] = toItineraryDetailResponse(itinerary).days;

    expect(day).not.toHaveProperty('notes');
    expect(Object.keys(day).sort()).toEqual([
      'activities',
      'cityId',
      'date',
      'dayNumber',
      'id',
      'transportCosts',
    ]);
  });
});

describe('city groups (ITN-09)', () => {
  /** Stored days for these cities, in order. */
  const daysIn = (...cities: string[]) =>
    stored({ days: cities.map((cityId) => ({ cityId })) }).days;

  it('groups consecutive days in the same city, with numbers, dates and day count', () => {
    expect(
      toCityGroups(daysIn('cairo', 'cairo', 'cairo', 'luxor'), '2026-12-20'),
    ).toEqual([
      {
        cityId: 'cairo',
        firstDayNumber: 1,
        lastDayNumber: 3,
        startDate: '2026-12-20',
        endDate: '2026-12-22',
        dayCount: 3,
        budgetSubtotal: [],
      },
      {
        cityId: 'luxor',
        firstDayNumber: 4,
        lastDayNumber: 4,
        startDate: '2026-12-23',
        endDate: '2026-12-23',
        dayCount: 1,
        budgetSubtotal: [],
      },
    ]);
  });

  it('gives a city visited twice two groups when other days are in between', () => {
    const groups = toCityGroups(
      daysIn('cairo', 'luxor', 'cairo'),
      '2026-12-20',
    );

    expect(groups.map((group) => [group.cityId, group.dayCount])).toEqual([
      ['cairo', 1],
      ['luxor', 1],
      ['cairo', 1],
    ]);
  });

  it('gives no group to an itinerary without days', () => {
    expect(toCityGroups([], '2026-12-20')).toEqual([]);
  });

  it('adds activity costs, budget entries and transport costs of the group days, per currency', () => {
    const itinerary = stored({
      days: [
        {
          cityId: 'cairo',
          activities: [
            { name: 'Museum', cost: 20000, currency: 'EGP' },
            { name: 'Walk' },
          ],
          budgetEntries: [
            { category: BudgetCategory.Food, amount: 5000, currency: 'EGP' },
          ],
        },
        {
          cityId: 'cairo',
          budgetEntries: [
            { category: BudgetCategory.Food, amount: 1200, currency: 'USD' },
          ],
          transportCosts: [
            {
              mode: 'train',
              fromCityId: 'cairo',
              toCityId: 'luxor',
              amount: 90000,
              currency: 'EGP',
            },
          ],
        },
        {
          cityId: 'luxor',
          activities: [{ name: 'Karnak', cost: 0, currency: 'EGP' }],
        },
      ],
    });

    const [cairo, luxor] = toCityGroups(itinerary.days, '2026-12-20');

    expect(cairo.budgetSubtotal).toEqual([
      { amount: 115000, currency: 'EGP' },
      { amount: 1200, currency: 'USD' },
    ]);
    expect(luxor.budgetSubtotal).toEqual([{ amount: 0, currency: 'EGP' }]);
  });

  it('includes the groups in the detail response', () => {
    const itinerary = stored({
      days: [{ cityId: 'cairo' }, { cityId: 'cairo' }],
    });

    expect(toItineraryDetailResponse(itinerary).cityGroups).toEqual([
      expect.objectContaining({ cityId: 'cairo', dayCount: 2 }),
    ]);
  });
});

describe('dayCosts and totalPerCurrency', () => {
  it('skips an activity that has no cost', () => {
    const [day] = stored({
      days: [{ cityId: 'cairo', activities: [{ name: 'Walk' }] }],
    }).days;

    expect(dayCosts(day)).toEqual([]);
  });

  it('adds up per currency and sorts by currency code', () => {
    expect(
      totalPerCurrency([
        { amount: 1, currency: 'USD' },
        { amount: 2, currency: 'EGP' },
        { amount: 3, currency: 'USD' },
      ]),
    ).toEqual([
      { amount: 2, currency: 'EGP' },
      { amount: 4, currency: 'USD' },
    ]);
  });
});

describe('toActivityResponse (ITN-10, ITN-12)', () => {
  it('returns every field an activity has, with its id', () => {
    const [day] = stored({
      days: [
        {
          cityId: 'cairo',
          activities: [
            {
              name: 'Museum',
              description: 'Two hours',
              time: '09:30',
              cost: 20000,
              currency: 'EGP',
            },
          ],
        },
      ],
    }).days;

    expect(toActivityResponse(day.activities[0])).toEqual({
      id: day.activities[0]._id.toString(),
      name: 'Museum',
      description: 'Two hours',
      time: '09:30',
      cost: 20000,
      currency: 'EGP',
      images: [],
    });
  });

  it('leaves out the optional fields an activity does not have, and lists no images', () => {
    const [day] = stored({
      days: [{ cityId: 'cairo', activities: [{ name: 'Walk' }] }],
    }).days;

    expect(toActivityResponse(day.activities[0])).toEqual({
      id: day.activities[0]._id.toString(),
      name: 'Walk',
      images: [],
    });
  });

  it('lists the images in order, each with the URL it is served at (ITN-12)', () => {
    const [day] = stored({
      days: [
        {
          cityId: 'cairo',
          activities: [{ name: 'Walk', images: ['a1.jpg', 'b2.png'] }],
        },
      ],
    }).days;

    expect(toActivityResponse(day.activities[0]).images).toEqual([
      { filename: 'a1.jpg', url: '/api/uploads/a1.jpg' },
      { filename: 'b2.png', url: '/api/uploads/b2.png' },
    ]);
  });

  it('keeps a cost of 0', () => {
    const [day] = stored({
      days: [
        {
          cityId: 'cairo',
          activities: [{ name: 'Park', cost: 0, currency: 'EGP' }],
        },
      ],
    }).days;

    expect(toActivityResponse(day.activities[0])).toMatchObject({
      cost: 0,
      currency: 'EGP',
    });
  });
});

describe('toTransportCostResponse (ITN-16)', () => {
  it('returns every field with the id', () => {
    const [day] = stored({
      days: [
        {
          cityId: 'cairo',
          transportCosts: [
            {
              mode: 'train',
              fromCityId: 'cairo',
              toCityId: 'luxor',
              amount: 90000,
              currency: 'EGP',
            },
          ],
        },
      ],
    }).days;
    const [cost] = day.transportCosts;

    expect(toTransportCostResponse(cost)).toEqual({
      id: cost._id.toString(),
      mode: 'train',
      fromCityId: 'cairo',
      toCityId: 'luxor',
      amount: 90000,
      currency: 'EGP',
    });
  });
});

describe('clonedFrom (ITN-21)', () => {
  it('names the original and its author on a clone only', () => {
    const itineraryId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const clone = stored({
      cloneSource: { itineraryId, authorId, authorName: 'Sara Ahmed' },
    });

    expect(toItineraryDetailResponse(clone).clonedFrom).toEqual({
      itineraryId: itineraryId.toString(),
      authorId: authorId.toString(),
      authorName: 'Sara Ahmed',
    });
    expect(toItineraryDetailResponse(stored())).not.toHaveProperty(
      'clonedFrom',
    );
  });
});
