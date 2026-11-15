import { Mongoose, Types } from 'mongoose';
import { BudgetCategory } from '../enums/budget-category.enum';
import { ItineraryModeration } from '../enums/itinerary-moderation.enum';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';
import { ITINERARY_MAX_DAYS } from '../itineraries.constants';
import { Itinerary, ItinerarySchema } from './itinerary.schema';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const valid = {
  ownerId: new Types.ObjectId(),
  title: 'Ten days in Egypt',
  countries: ['EG'],
  startDate: '2026-12-20',
};

const day = (extra: Record<string, unknown> = {}) => ({
  cityId: 'cairo',
  ...extra,
});

const invalidFields = (data: Record<string, unknown>): Promise<string[]> =>
  new ItineraryModel(data).validate().then(
    () => [],
    (error: { errors: Record<string, unknown> }) =>
      Object.keys(error.errors).sort(),
  );

describe('Itinerary model', () => {
  it('accepts an itinerary with an owner, a title, a country and a start date', async () => {
    expect(await invalidFields(valid)).toEqual([]);
  });

  it('starts private, visible, with no days', () => {
    const itinerary = new ItineraryModel(valid);

    expect(itinerary.visibility).toBe(ItineraryVisibility.Private);
    expect(itinerary.moderation).toBe(ItineraryModeration.Visible);
    expect(itinerary.authorDeactivated).toBe(false);
    expect(itinerary.days).toHaveLength(0);
    expect(itinerary.dayCount).toBe(0);
    expect(itinerary.cloneSource).toBeUndefined();
  });

  it.each(['ownerId', 'title', 'startDate'])('requires %s', async (field) => {
    expect(await invalidFields({ ...valid, [field]: undefined })).toContain(
      field,
    );
  });

  it('trims the title and rejects one above 100 characters', async () => {
    expect(new ItineraryModel({ ...valid, title: '  Egypt  ' }).title).toBe(
      'Egypt',
    );
    expect(await invalidFields({ ...valid, title: 'x'.repeat(101) })).toEqual([
      'title',
    ]);
  });

  it('rejects an itinerary with no country', async () => {
    expect(await invalidFields({ ...valid, countries: [] })).toEqual([
      'countries',
    ]);
  });

  it('rejects a start date that is not YYYY-MM-DD', async () => {
    expect(
      await invalidFields({ ...valid, startDate: '2026-12-20T00:00:00Z' }),
    ).toEqual(['startDate']);
  });

  it('rejects a visibility or moderation value that does not exist', async () => {
    expect(await invalidFields({ ...valid, visibility: 'shared' })).toEqual([
      'visibility',
    ]);
    expect(await invalidFields({ ...valid, moderation: 'deleted' })).toEqual([
      'moderation',
    ]);
  });

  it('rejects more than 60 days', async () => {
    const days = Array.from({ length: ITINERARY_MAX_DAYS + 1 }, () => day());

    expect(await invalidFields({ ...valid, days })).toEqual(['days']);
  });

  it('requires a city on every day', async () => {
    expect(await invalidFields({ ...valid, days: [{ notes: 'x' }] })).toEqual([
      'days.0.cityId',
    ]);
  });

  it('gives every day, activity, budget entry and transport cost its own id', () => {
    const itinerary = new ItineraryModel({
      ...valid,
      days: [
        day({
          activities: [{ name: 'Giza Pyramids' }],
          budgetEntries: [
            { category: BudgetCategory.Food, amount: 1500, currency: 'EGP' },
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
        }),
      ],
    });
    const [first] = itinerary.days;

    expect(first._id).toBeInstanceOf(Types.ObjectId);
    expect(first.activities[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(first.activities[0].images).toHaveLength(0);
    expect(first.budgetEntries[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(first.transportCosts[0]._id).toBeInstanceOf(Types.ObjectId);
  });

  it('accepts an activity with a time and a cost', async () => {
    const activities = [
      { name: 'Museum', time: '09:30', cost: 20000, currency: 'EGP' },
    ];

    expect(
      await invalidFields({ ...valid, days: [day({ activities })] }),
    ).toEqual([]);
  });

  it('rejects an activity with no name, a bad time or a negative cost', async () => {
    const activities = [{ time: '25:00', cost: -1 }];

    expect(
      await invalidFields({ ...valid, days: [day({ activities })] }),
    ).toEqual([
      'days.0.activities.0.cost',
      'days.0.activities.0.name',
      'days.0.activities.0.time',
    ]);
  });

  it('rejects a budget entry with an unknown category, a negative or fractional amount, or no currency', async () => {
    const entry = {
      category: BudgetCategory.Food,
      amount: 100,
      currency: 'USD',
    };
    const fieldsFor = (budgetEntry: Record<string, unknown>) =>
      invalidFields({
        ...valid,
        days: [day({ budgetEntries: [budgetEntry] })],
      });

    expect(await fieldsFor({ ...entry, category: 'shopping' })).toEqual([
      'days.0.budgetEntries.0.category',
    ]);
    expect(await fieldsFor({ ...entry, amount: -1 })).toEqual([
      'days.0.budgetEntries.0.amount',
    ]);
    expect(await fieldsFor({ ...entry, amount: 10.5 })).toEqual([
      'days.0.budgetEntries.0.amount',
    ]);
    expect(await fieldsFor({ ...entry, currency: undefined })).toEqual([
      'days.0.budgetEntries.0.currency',
    ]);
  });

  it('rejects a transport cost with no cities or a currency that is not a code', async () => {
    const transportCosts = [{ mode: 'bus', amount: 500, currency: 'pounds' }];

    expect(
      await invalidFields({ ...valid, days: [day({ transportCosts })] }),
    ).toEqual([
      'days.0.transportCosts.0.currency',
      'days.0.transportCosts.0.fromCityId',
      'days.0.transportCosts.0.toCityId',
    ]);
  });

  it('keeps the original author on a clone', async () => {
    const cloneSource = {
      itineraryId: new Types.ObjectId(),
      authorId: new Types.ObjectId(),
      authorName: 'Omar Hossam',
    };

    expect(await invalidFields({ ...valid, cloneSource })).toEqual([]);
    expect(await invalidFields({ ...valid, cloneSource: {} })).toEqual([
      'cloneSource.authorId',
      'cloneSource.authorName',
      'cloneSource.itineraryId',
    ]);
  });

  it('declares the indexes of the data model', () => {
    const indexes = ItinerarySchema.indexes().map(([fields]) => fields);

    expect(indexes).toEqual(
      expect.arrayContaining([
        { ownerId: 1, updatedAt: -1 },
        { visibility: 1, moderation: 1, authorDeactivated: 1, dayCount: 1 },
        { title: 'text' },
        { countries: 1 },
        { 'days.cityId': 1 },
      ]),
    );
  });
});
