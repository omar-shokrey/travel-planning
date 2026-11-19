import { Types } from 'mongoose';
import { toHotelSearchResult } from './hotel-search-result.mapper';
import type { HotelSource } from './hotel.mapper';

const hotel: HotelSource = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  name: 'Cairo Garden Hotel',
  addressLine: '12 Nile Street',
  cityId: 'cairo',
  countryCode: 'EG',
  description: 'Quiet.',
  photos: ['a.jpg'],
  starClass: 4,
  amenities: ['wifi'],
  active: true,
  ratingCount: 3,
  averageRating: 4.3,
  createdAt: new Date('2026-11-01T10:00:00.000Z'),
  updatedAt: new Date('2026-11-02T10:00:00.000Z'),
};

const room = (pricePerNight: number) => ({
  maxOccupancy: 2,
  pricePerNight,
  availability: [],
});

describe('toHotelSearchResult (HTL-11)', () => {
  it('gives the public hotel fields, the free rooms and the lowest price per night', () => {
    expect(
      toHotelSearchResult(hotel, [room(12000), room(9500), room(30000)]),
    ).toEqual({
      id: '6740f1c2a4b5c6d7e8f90123',
      name: 'Cairo Garden Hotel',
      addressLine: '12 Nile Street',
      cityId: 'cairo',
      countryCode: 'EG',
      description: 'Quiet.',
      photos: [{ filename: 'a.jpg', url: '/api/uploads/a.jpg' }],
      starClass: 4,
      amenities: ['wifi'],
      active: true,
      ratingCount: 3,
      averageRating: 4.3,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      freeRooms: 3,
      lowestPricePerNight: 9500,
      currency: 'USD',
    });
  });
});
