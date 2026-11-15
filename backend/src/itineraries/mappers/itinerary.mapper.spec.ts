import { Mongoose, Types } from 'mongoose';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from '../models/itinerary.schema';
import { toItineraryResponse } from './itinerary.mapper';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const ownerId = new Types.ObjectId();
const stored = (): ItineraryDocument =>
  new ItineraryModel({
    ownerId,
    title: 'Ten days in Egypt',
    countries: ['EG', 'AE'],
    startDate: '2026-12-20',
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
