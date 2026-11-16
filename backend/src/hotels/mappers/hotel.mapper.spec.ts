import { Types } from 'mongoose';
import { toHotelResponse, type HotelSource } from './hotel.mapper';

const source: HotelSource = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  name: 'Cairo Garden Hotel',
  addressLine: '12 Nile Street',
  cityId: 'city_001',
  countryCode: 'EG',
  description: 'A quiet hotel close to the city centre.',
  photos: ['c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg'],
  starClass: 4,
  amenities: ['wifi', 'pool'],
  active: true,
  ratingCount: 0,
  averageRating: 0,
  createdAt: new Date('2026-11-05T13:00:00.000+02:00'),
  updatedAt: new Date('2026-11-06T13:00:00.000+02:00'),
};

describe('toHotelResponse (HTL-01)', () => {
  it('maps public fields, string id, photo urls and UTC timestamps', () => {
    expect(toHotelResponse(source)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90123',
      name: 'Cairo Garden Hotel',
      addressLine: '12 Nile Street',
      cityId: 'city_001',
      countryCode: 'EG',
      description: 'A quiet hotel close to the city centre.',
      photos: [
        {
          filename: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
          url: '/api/uploads/c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
        },
      ],
      starClass: 4,
      amenities: ['wifi', 'pool'],
      active: true,
      ratingCount: 0,
      averageRating: 0,
      createdAt: '2026-11-05T11:00:00.000Z',
      updatedAt: '2026-11-06T11:00:00.000Z',
    });
  });

  it('does not copy unlisted internal fields into the response', () => {
    const storedHotel: HotelSource & {
      internalHold: string;
      providerSecret: string;
    } = {
      ...source,
      internalHold: 'private',
      providerSecret: 'private',
    };
    const response = toHotelResponse(storedHotel);

    expect(Object.keys(response).sort()).toEqual([
      'active',
      'addressLine',
      'amenities',
      'averageRating',
      'cityId',
      'countryCode',
      'createdAt',
      'description',
      'id',
      'name',
      'photos',
      'ratingCount',
      'starClass',
      'updatedAt',
    ]);
  });
});
