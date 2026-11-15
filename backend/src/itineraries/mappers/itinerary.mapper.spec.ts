import { Mongoose, Types } from 'mongoose';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from '../models/itinerary.schema';
import {
  dayDate,
  toItineraryDetailResponse,
  toItineraryResponse,
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
      dayCount: 0,
    });
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
    expect(response).not.toHaveProperty('moderation');
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
      },
      {
        id: itinerary.days[1]._id.toString(),
        dayNumber: 2,
        date: '2026-12-31',
        cityId: 'cairo',
      },
      {
        id: itinerary.days[2]._id.toString(),
        dayNumber: 3,
        date: '2027-01-01',
        cityId: 'dubai',
      },
    ]);
  });

  it('leaves out empty notes and the embedded lists of later features', () => {
    const itinerary = stored({ days: [{ cityId: 'cairo', notes: '' }] });
    const [day] = toItineraryDetailResponse(itinerary).days;

    expect(day).not.toHaveProperty('notes');
    expect(Object.keys(day).sort()).toEqual([
      'cityId',
      'date',
      'dayNumber',
      'id',
    ]);
  });
});
