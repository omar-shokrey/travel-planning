import { Mongoose } from 'mongoose';
import { Hotel, HotelSchema } from './hotel.schema';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const HotelModel = mongoose.model(Hotel.name, HotelSchema);

const valid = {
  name: 'Cairo Garden Hotel',
  addressLine: '12 Nile Street',
  cityId: 'city_001',
  countryCode: 'EG',
  description: 'A quiet hotel close to the city centre.',
  starClass: 4,
  amenities: ['wifi', 'pool'],
};

const invalidFields = (data: Record<string, unknown>): Promise<string[]> =>
  new HotelModel(data).validate().then(
    () => [],
    (error: { errors: Record<string, unknown> }) =>
      Object.keys(error.errors).sort(),
  );

describe('Hotel model (HTL-01)', () => {
  it('sets server-controlled defaults and timestamps', () => {
    const hotel = new HotelModel(valid);

    expect(hotel.photos).toEqual([]);
    expect(hotel.active).toBe(true);
    expect(hotel.ratingCount).toBe(0);
    expect(hotel.averageRating).toBe(0);
    expect(HotelSchema.options.timestamps).toBe(true);
  });

  it.each([0, 6, 3.5])('rejects star class %s', async (starClass) => {
    expect(await invalidFields({ ...valid, starClass })).toContain('starClass');
  });

  it('rejects amenities beyond the proposed count and length limits', async () => {
    expect(
      await invalidFields({ ...valid, amenities: Array(31).fill('wifi') }),
    ).toContain('amenities');
    expect(
      await invalidFields({ ...valid, amenities: ['a'.repeat(51)] }),
    ).toContain('amenities');
  });

  it('requires the profile and reference fields', async () => {
    expect(await invalidFields({})).toEqual([
      'addressLine',
      'cityId',
      'countryCode',
      'description',
      'name',
      'starClass',
    ]);
  });

  it('indexes city and active status together', () => {
    expect(HotelSchema.indexes()).toContainEqual([
      { cityId: 1, active: 1 },
      expect.any(Object),
    ]);
  });
});
