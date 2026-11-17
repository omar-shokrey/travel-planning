import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { HotelDetailsService } from './hotel-details.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';

const storedHotel = () => ({
  _id: new Types.ObjectId(HOTEL_ID),
  name: 'Cairo Garden Hotel',
  addressLine: '12 Nile Street',
  cityId: 'city_001',
  countryCode: 'EG',
  description: 'A quiet hotel close to the city centre.',
  photos: ['c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg'],
  starClass: 4,
  amenities: ['wifi', 'pool'],
  active: true,
  ratingCount: 12,
  averageRating: 4.5,
  createdAt: new Date('2026-11-05T11:00:00.000Z'),
  updatedAt: new Date('2026-11-06T09:30:00.000Z'),
});

const setup = (found: object | null) => {
  const hotels = {
    findOne: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
  };
  const service = new HotelDetailsService(hotels as never);
  return { service, hotels };
};

describe('HotelDetailsService', () => {
  describe('findActiveById (HTL-02)', () => {
    it('returns the profile, photos, amenities and rating of the hotel', async () => {
      const { service } = setup(storedHotel());

      const result = await service.findActiveById(HOTEL_ID);

      expect(result).toEqual({
        id: HOTEL_ID,
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
        ratingCount: 12,
        averageRating: 4.5,
        createdAt: '2026-11-05T11:00:00.000Z',
        updatedAt: '2026-11-06T09:30:00.000Z',
        policy: null,
      });
    });

    it('shows the check-in and check-out times the moderator set (HTL-09)', async () => {
      const { service } = setup({
        ...storedHotel(),
        policy: { checkInTime: '14:00', checkOutTime: '12:00' },
      });

      const result = await service.findActiveById(HOTEL_ID);

      expect(result.policy).toEqual({
        checkInTime: '14:00',
        checkOutTime: '12:00',
      });
    });

    it('looks only for an active hotel, so a deactivated one stays hidden', async () => {
      const { service, hotels } = setup(storedHotel());

      await service.findActiveById(HOTEL_ID);

      expect(hotels.findOne).toHaveBeenCalledWith({
        _id: HOTEL_ID,
        active: true,
      });
    });

    it('answers 404 when no active hotel has this id', async () => {
      const { service } = setup(null);

      await expect(service.findActiveById(HOTEL_ID)).rejects.toThrow(
        new NotFoundException('Hotel not found'),
      );
    });
  });
});
