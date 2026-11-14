import { toAirportResponse } from './airport.mapper';

describe('toAirportResponse', () => {
  it('maps only the public airport response fields', () => {
    const airport = {
      _id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      __v: 3,
    };

    const city = {
      _id: 'cairo',
      name: 'Cairo',
      countryCode: 'EG',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      __v: 2,
    };

    const country = {
      _id: 'EG',
      name: 'Egypt',
      currency: 'EGP',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      __v: 1,
    };

    const result = toAirportResponse(airport, city, country);

    expect(result).toEqual({
      code: 'CAI',
      name: 'Cairo International Airport',
      city: 'Cairo',
      country: 'Egypt',
      timeZone: 'Africa/Cairo',
    });

    expect(result).not.toHaveProperty('_id');
    expect(result).not.toHaveProperty('cityId');
    expect(result).not.toHaveProperty('countryCode');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('__v');
  });
});
