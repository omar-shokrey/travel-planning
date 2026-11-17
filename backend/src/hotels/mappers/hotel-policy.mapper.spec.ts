import { Types } from 'mongoose';
import {
  toHotelDetailsResponse,
  toHotelPolicyResponse,
} from './hotel-policy.mapper';

const hotel = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  name: 'Cairo Garden Hotel',
  addressLine: '12 Nile Street',
  cityId: 'city_001',
  countryCode: 'EG',
  description: 'A quiet hotel close to the city centre.',
  photos: [],
  starClass: 4,
  amenities: ['wifi'],
  active: true,
  ratingCount: 0,
  averageRating: 0,
  createdAt: new Date('2026-11-05T11:00:00.000Z'),
  updatedAt: new Date('2026-11-05T11:00:00.000Z'),
};

describe('toHotelPolicyResponse', () => {
  it('returns the check-in and check-out times', () => {
    expect(
      toHotelPolicyResponse({ checkInTime: '14:00', checkOutTime: '12:00' }),
    ).toEqual({ checkInTime: '14:00', checkOutTime: '12:00' });
  });

  it('returns null when the hotel has no policies yet', () => {
    expect(toHotelPolicyResponse(undefined)).toBeNull();
    expect(toHotelPolicyResponse(null)).toBeNull();
  });

  it('returns only the public fields', () => {
    const stored = {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      internalNote: 'not for the client',
    };

    expect(toHotelPolicyResponse(stored)).toEqual({
      checkInTime: '14:00',
      checkOutTime: '12:00',
    });
  });
});

describe('toHotelDetailsResponse', () => {
  it('adds the policies to the hotel profile', () => {
    const details = toHotelDetailsResponse({
      ...hotel,
      policy: { checkInTime: '15:00', checkOutTime: '11:00' },
    });

    expect(details).toMatchObject({
      id: '6740f1c2a4b5c6d7e8f90123',
      name: 'Cairo Garden Hotel',
      policy: { checkInTime: '15:00', checkOutTime: '11:00' },
    });
  });

  it('shows policy null for a hotel without policies', () => {
    expect(toHotelDetailsResponse(hotel).policy).toBeNull();
  });
});
