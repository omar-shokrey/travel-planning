import { Types } from 'mongoose';
import { toHotelSearchResultResponse } from './hotel-search-result.mapper';

describe('toHotelSearchResultResponse (HTL-11)', () => {
  it('returns the public summary of the hotel with its free rooms summed up', () => {
    const hotel = {
      _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
      name: 'Cairo Garden Hotel',
      addressLine: '12 Nile Street',
      cityId: 'cairo',
      countryCode: 'EG',
      description: 'Not part of a search result.',
      starClass: 4,
      amenities: ['wifi'],
      photos: ['c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg'],
      active: true,
      averageRating: 4.5,
      ratingCount: 12,
    };

    expect(
      toHotelSearchResultResponse(hotel, [
        { maxOccupancy: 2, pricePerNight: 15000 },
        { maxOccupancy: 3, pricePerNight: 9000 },
      ]),
    ).toEqual({
      id: '6740f1c2a4b5c6d7e8f90123',
      name: 'Cairo Garden Hotel',
      addressLine: '12 Nile Street',
      cityId: 'cairo',
      countryCode: 'EG',
      starClass: 4,
      amenities: ['wifi'],
      photos: [
        {
          filename: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
          url: '/api/uploads/c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
        },
      ],
      averageRating: 4.5,
      ratingCount: 12,
      freeRooms: 2,
      cheapestPricePerNight: 9000,
      currency: 'USD',
    });
  });
});
