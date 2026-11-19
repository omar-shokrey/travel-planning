import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { HotelDetailsService } from './hotel-details.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const NOW = new Date('2099-03-01T12:00:00.000Z');
/** A stay far in the future, so "check-in in the past" never trips. */
const DATES = { checkIn: '2099-03-10', checkOut: '2099-03-13' };
const STAY = { from: DATES.checkIn, to: DATES.checkOut };

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
  const freeRoom = {
    id: '6740f1c2a4b5c6d7e8f90124',
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 12500,
    nights: 3,
    totalPrice: 37500,
    currency: 'USD',
  };
  const availableRooms = {
    listAvailable: jest.fn().mockResolvedValue([freeRoom]),
  };
  const service = new HotelDetailsService(
    hotels as never,
    availableRooms as unknown as HotelAvailableRoomsService,
  );
  return { service, hotels, availableRooms, freeRoom };
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
        availableRooms: null,
      });
    });

    it('does not look for rooms when no dates are sent', async () => {
      const { service, availableRooms } = setup(storedHotel());

      await service.findActiveById(HOTEL_ID, {});

      expect(availableRooms.listAvailable).not.toHaveBeenCalled();
    });

    it('lists the free rooms for the stay when both dates are sent (HTL-15)', async () => {
      const { service, availableRooms, freeRoom } = setup(storedHotel());

      const result = await service.findActiveById(HOTEL_ID, DATES, NOW);

      expect(availableRooms.listAvailable).toHaveBeenCalledWith(
        new Types.ObjectId(HOTEL_ID),
        STAY,
        NOW,
      );
      expect(result.availableRooms).toEqual([freeRoom]);
    });

    it('shows an empty list, not null, when dates are sent and no room is free', async () => {
      const { service, availableRooms } = setup(storedHotel());
      availableRooms.listAvailable.mockResolvedValue([]);

      const result = await service.findActiveById(HOTEL_ID, DATES, NOW);

      expect(result.availableRooms).toEqual([]);
    });

    it('does not list rooms when only one date reaches it (the DTO answers 400 first)', async () => {
      const { service, availableRooms } = setup(storedHotel());

      const result = await service.findActiveById(HOTEL_ID, {
        checkIn: DATES.checkIn,
      });

      expect(result.availableRooms).toBeNull();
      expect(availableRooms.listAvailable).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a check-in in the past',
        { checkIn: '2020-01-01', checkOut: '2020-01-02' },
        'checkIn',
        'checkIn cannot be in the past',
      ],
      [
        'a stay of 367 nights',
        { checkIn: '2099-01-01', checkOut: '2100-01-03' },
        'checkOut',
        'A stay can have at most 366 nights',
      ],
    ])(
      'answers 400 for %s, as hotel search does, before it reads the hotel',
      async (_label, dates, field, message) => {
        const { service, hotels } = setup(storedHotel());

        const error = await service
          .findActiveById(HOTEL_ID, dates, NOW)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          message: 'Validation failed',
          errors: [{ field, messages: [message] }],
        });
        expect(hotels.findOne).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for a deactivated hotel even with dates, and lists no rooms', async () => {
      const { service, availableRooms } = setup(null);

      await expect(
        service.findActiveById(HOTEL_ID, DATES, NOW),
      ).rejects.toThrow(new NotFoundException('Hotel not found'));
      expect(availableRooms.listAvailable).not.toHaveBeenCalled();
    });

    it('shows the times and the cancellation policy the moderator set (HTL-09, HTL-10)', async () => {
      const { service } = setup({
        ...storedHotel(),
        policy: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        },
      });

      const result = await service.findActiveById(HOTEL_ID);

      expect(result.policy).toEqual({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
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
