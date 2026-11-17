import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import type { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { RoomNightState } from './models/room-night-state.enum';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';

/** A date `days` after today (UTC), so the tests never fall in the past. */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

const range = (from: string, to: string) => ({ from, to });

const storedRoom = (number: string, fields: object = {}) => ({
  _id: new Types.ObjectId(),
  hotelId: new Types.ObjectId(HOTEL_ID),
  number,
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
  availability: [range(day(0), day(60))],
  ...fields,
});

/** A Mongoose query that resolves to `value`, with the chain the service uses. */
const query = <T>(value: T) => {
  const chain = {
    select: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const step of ['select', 'sort', 'lean'] as const) {
    chain[step].mockReturnValue(chain);
  }
  return chain;
};

const stayQuery = (checkIn: string, checkOut: string, page = 1, limit = 10) =>
  ({
    checkIn,
    checkOut,
    page,
    limit,
    skip: (page - 1) * limit,
  }) as AvailableRoomsQueryDto;

const setup = (
  options: {
    hotel?: boolean;
    rooms?: ReturnType<typeof storedRoom>[];
    taken?: Types.ObjectId[];
  } = {},
) => {
  const hotelFound = options.hotel ?? true;
  const hotels = {
    exists: jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(
          hotelFound ? { _id: new Types.ObjectId(HOTEL_ID) } : null,
        ),
    }),
  };
  const rooms = {
    find: jest.fn().mockReturnValue(query(options.rooms ?? [])),
  };
  const roomNights = {
    distinct: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(options.taken ?? []),
    }),
  };
  const service = new HotelAvailableRoomsService(
    hotels as never,
    rooms as never,
    roomNights as never,
  );
  return { service, hotels, rooms, roomNights };
};

describe('HotelAvailableRoomsService (HTL-15)', () => {
  describe('findAvailable', () => {
    it('lists the free rooms with the nights and the total price', async () => {
      const room = storedRoom('101');
      const { service, hotels } = setup({ rooms: [room] });

      const result = await service.findAvailable(
        HOTEL_ID,
        stayQuery(day(5), day(8)),
      );

      expect(hotels.exists).toHaveBeenCalledWith({
        _id: HOTEL_ID,
        active: true,
      });
      expect(result).toEqual({
        items: [
          {
            id: room._id.toString(),
            number: '101',
            type: 'Double',
            beds: 2,
            maxOccupancy: 3,
            pricePerNight: 12500,
            nights: 3,
            totalPrice: 37500,
            currency: 'USD',
          },
        ],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });
    });

    it('pages through the free rooms', async () => {
      const rooms = ['101', '102', '103'].map((number) => storedRoom(number));
      const { service } = setup({ rooms });

      const result = await service.findAvailable(
        HOTEL_ID,
        stayQuery(day(5), day(6), 2, 2),
      );

      expect(result.items.map((room) => room.number)).toEqual(['103']);
      expect(result.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('answers 404 for a hotel that is missing or deactivated', async () => {
      const { service, rooms } = setup({ hotel: false });

      await expect(
        service.findAvailable(HOTEL_ID, stayQuery(day(5), day(8))),
      ).rejects.toThrow(NotFoundException);
      expect(rooms.find).not.toHaveBeenCalled();
    });

    it('answers 400 for a check-in in the past before reading anything', async () => {
      const { service, hotels } = setup();

      await expect(
        service.findAvailable(HOTEL_ID, stayQuery(day(-1), day(2))),
      ).rejects.toThrow(
        new BadRequestException('The check-in date cannot be in the past'),
      );
      expect(hotels.exists).not.toHaveBeenCalled();
    });
  });

  describe('assertStay', () => {
    it('accepts a stay that starts today', () => {
      expect(() =>
        setup().service.assertStay(range(day(0), day(1))),
      ).not.toThrow();
    });

    it('accepts 366 nights and refuses 367', () => {
      const { service } = setup();
      expect(() => service.assertStay(range(day(1), day(367)))).not.toThrow();
      expect(() => service.assertStay(range(day(1), day(368)))).toThrow(
        BadRequestException,
      );
    });
  });

  describe('findFreeRoomEntities', () => {
    it('reads only the active rooms of the hotel, by room number', async () => {
      const { service, rooms } = setup();

      await service.findFreeRoomEntities(
        new Types.ObjectId(HOTEL_ID),
        range(day(5), day(8)),
      );

      expect(rooms.find).toHaveBeenCalledWith({
        hotelId: { $in: [new Types.ObjectId(HOTEL_ID)] },
        active: true,
      });
    });

    it('leaves out a room whose availability does not cover every night', async () => {
      const covered = storedRoom('101');
      const gap = storedRoom('102', {
        availability: [range(day(0), day(6)), range(day(7), day(30))],
      });
      const ends = storedRoom('103', {
        availability: [range(day(0), day(7))],
      });
      const { service } = setup({ rooms: [covered, gap, ends] });

      const free = await service.findFreeRoomEntities(
        new Types.ObjectId(HOTEL_ID),
        range(day(5), day(8)),
      );

      expect(free.map((room) => room.number)).toEqual(['101']);
    });

    it('accepts a stay that spans two touching availability ranges', async () => {
      const room = storedRoom('101', {
        availability: [range(day(0), day(6)), range(day(6), day(30))],
      });
      const { service } = setup({ rooms: [room] });

      const free = await service.findFreeRoomEntities(
        new Types.ObjectId(HOTEL_ID),
        range(day(5), day(8)),
      );

      expect(free).toHaveLength(1);
    });

    it('leaves out a room with a booked, blocked or held night in the stay', async () => {
      const free = storedRoom('101');
      const taken = storedRoom('102');
      const { service, roomNights } = setup({
        rooms: [free, taken],
        taken: [taken._id],
      });

      const result = await service.findFreeRoomEntities(
        new Types.ObjectId(HOTEL_ID),
        range(day(5), day(8)),
      );

      expect(result.map((room) => room.number)).toEqual(['101']);
      expect(roomNights.distinct).toHaveBeenCalledWith('roomId', {
        roomId: { $in: [free._id, taken._id] },
        date: { $gte: day(5), $lt: day(8) },
        $or: [
          { state: { $in: [RoomNightState.Booked, RoomNightState.Blocked] } },
          {
            state: RoomNightState.Held,
            holdExpiresAt: { $gt: expect.any(Date) as Date },
          },
        ],
      });
    });

    it('does not read the nights when no room is bookable', async () => {
      const { service, roomNights } = setup({ rooms: [] });

      const free = await service.findFreeRoomEntities(
        new Types.ObjectId(HOTEL_ID),
        range(day(5), day(8)),
      );

      expect(free).toEqual([]);
      expect(roomNights.distinct).not.toHaveBeenCalled();
    });

    it('returns only the fields the callers need, never the availability', async () => {
      const { service } = setup({ rooms: [storedRoom('101')] });

      const [room] = await service.findFreeRoomEntities(
        new Types.ObjectId(HOTEL_ID),
        range(day(5), day(8)),
      );

      expect(Object.keys(room).sort()).toEqual([
        '_id',
        'beds',
        'maxOccupancy',
        'number',
        'pricePerNight',
        'type',
      ]);
    });
  });

  describe('findFreeRoomsOfHotels (HTL-11)', () => {
    const OTHER_HOTEL_ID = '6740f1c2a4b5c6d7e8f90199';

    it('groups the free rooms by hotel, and leaves out hotels with none', async () => {
      const a1 = storedRoom('101');
      const a2 = storedRoom('102');
      const b1 = storedRoom('201', {
        hotelId: new Types.ObjectId(OTHER_HOTEL_ID),
      });
      const { service } = setup({ rooms: [a1, a2, b1], taken: [b1._id] });

      const byHotel = await service.findFreeRoomsOfHotels(
        [new Types.ObjectId(HOTEL_ID), new Types.ObjectId(OTHER_HOTEL_ID)],
        range(day(5), day(8)),
      );

      expect([...byHotel.keys()]).toEqual([HOTEL_ID]);
      expect(byHotel.get(HOTEL_ID)?.map((room) => room.number)).toEqual([
        '101',
        '102',
      ]);
    });

    it('reads nothing for an empty list of hotels', async () => {
      const { service, rooms } = setup();

      const byHotel = await service.findFreeRoomsOfHotels(
        [],
        range(day(5), day(8)),
      );

      expect(byHotel.size).toBe(0);
      expect(rooms.find).not.toHaveBeenCalled();
    });
  });
});
