import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { HotelRoomsService } from './hotel-rooms.service';
import type { HotelsService } from './hotels.service';
import { RoomNightState } from './models/room-night-state.enum';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const ROOM_ID = '6740f1c2a4b5c6d7e8f90124';
const USER_ID = '6740f1c2a4b5c6d7e8f90125';

const range = (from: string, to: string) => ({ from, to });

/** A stored room with `set` and `save`, as much as the service uses. */
const storedRoom = () => {
  const room = {
    _id: new Types.ObjectId(ROOM_ID),
    hotelId: new Types.ObjectId(HOTEL_ID),
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 12500,
    active: true,
    availability: [range('2026-12-01', '2026-12-08')],
    createdAt: new Date('2026-11-05T11:00:00.000Z'),
    updatedAt: new Date('2026-11-05T11:00:00.000Z'),
    set: jest.fn((changes: Record<string, unknown>) => {
      Object.assign(room, changes);
    }),
    save: jest.fn().mockResolvedValue(undefined),
  };
  return room;
};

const setup = (
  options: {
    room?: ReturnType<typeof storedRoom> | null;
    reservedNights?: string[];
  } = {},
) => {
  const room = options.room === undefined ? storedRoom() : options.room;
  const hotel = { _id: new Types.ObjectId(HOTEL_ID) };

  const nightsQuery = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest
      .fn()
      .mockResolvedValue(
        (options.reservedNights ?? []).map((date) => ({ date })),
      ),
  };
  const rooms = {
    findOne: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(room) }),
  };
  const roomNights = { find: jest.fn().mockReturnValue(nightsQuery) };
  const hotelsService = {
    findManagedEntityOrThrow: jest.fn().mockResolvedValue(hotel),
  };

  const service = new HotelRoomsService(
    rooms as never,
    roomNights as never,
    hotelsService as unknown as HotelsService,
  );
  return { service, room, hotel, rooms, roomNights, hotelsService };
};

describe('HotelRoomsService', () => {
  describe('update (HTL-05)', () => {
    it('changes the beds, occupancy and price of a room of my hotel', async () => {
      const { service, room } = setup();

      const result = await service.update(
        HOTEL_ID,
        ROOM_ID,
        { beds: 3, maxOccupancy: 4, pricePerNight: 15000 },
        USER_ID,
      );

      expect(room!.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        id: ROOM_ID,
        hotelId: HOTEL_ID,
        beds: 3,
        maxOccupancy: 4,
        pricePerNight: 15000,
        currency: 'USD',
      });
    });

    it('keeps the fields that were not sent', async () => {
      const { service, room } = setup();

      const result = await service.update(
        HOTEL_ID,
        ROOM_ID,
        { pricePerNight: 9900 },
        USER_ID,
      );

      expect(room!.set).toHaveBeenCalledWith({ pricePerNight: 9900 });
      expect(result).toMatchObject({
        beds: 2,
        maxOccupancy: 3,
        pricePerNight: 9900,
        number: '101',
        type: 'Double',
      });
    });

    it('does not touch the nights of existing reservations when the price changes', async () => {
      const { service, roomNights } = setup();

      await service.update(HOTEL_ID, ROOM_ID, { pricePerNight: 9900 }, USER_ID);

      expect(roomNights.find).not.toHaveBeenCalled();
    });

    it('answers 400 when no field was sent, before anything is read', async () => {
      const { service, hotelsService } = setup();

      await expect(
        service.update(HOTEL_ID, ROOM_ID, {}, USER_ID),
      ).rejects.toThrow(
        new BadRequestException(
          'Send at least one of beds, maxOccupancy or pricePerNight',
        ),
      );

      expect(hotelsService.findManagedEntityOrThrow).not.toHaveBeenCalled();
    });

    it('looks for the room inside the hotel of the route', async () => {
      const { service, rooms, hotel, hotelsService } = setup();

      await service.update(HOTEL_ID, ROOM_ID, { beds: 1 }, USER_ID);

      expect(hotelsService.findManagedEntityOrThrow).toHaveBeenCalledWith(
        HOTEL_ID,
        USER_ID,
      );
      expect(rooms.findOne).toHaveBeenCalledWith({
        _id: ROOM_ID,
        hotelId: hotel._id,
      });
    });

    it('answers 404 for a room that is not in this hotel', async () => {
      const { service } = setup({ room: null });

      await expect(
        service.update(HOTEL_ID, ROOM_ID, { beds: 1 }, USER_ID),
      ).rejects.toThrow(new NotFoundException('Room not found'));
    });

    it('answers 403 and reads no room for a hotel the moderator does not manage', async () => {
      const { service, hotelsService, rooms } = setup();
      hotelsService.findManagedEntityOrThrow.mockRejectedValue(
        new ForbiddenException('You do not manage this hotel'),
      );

      await expect(
        service.update(HOTEL_ID, ROOM_ID, { beds: 1 }, USER_ID),
      ).rejects.toThrow(ForbiddenException);

      expect(rooms.findOne).not.toHaveBeenCalled();
    });
  });

  describe('setAvailability (HTL-05)', () => {
    it('replaces the ranges and stores them ordered by first night', async () => {
      const { service, room } = setup();

      const result = await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        {
          availability: [
            range('2026-12-20', '2027-01-05'),
            range('2026-12-01', '2026-12-08'),
          ],
        },
        USER_ID,
      );

      const expected = [
        range('2026-12-01', '2026-12-08'),
        range('2026-12-20', '2027-01-05'),
      ];
      expect(room!.availability).toEqual(expected);
      expect(room!.save).toHaveBeenCalledTimes(1);
      expect(result.availability).toEqual(expected);
    });

    it('accepts an empty list when the room has no reservation', async () => {
      const { service, room } = setup();

      const result = await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { availability: [] },
        USER_ID,
      );

      expect(room!.availability).toEqual([]);
      expect(result.availability).toEqual([]);
    });

    it('accepts ranges that only touch', async () => {
      const { service } = setup();

      const result = await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        {
          availability: [
            range('2026-12-01', '2026-12-08'),
            range('2026-12-08', '2026-12-12'),
          ],
        },
        USER_ID,
      );

      expect(result.availability).toHaveLength(2);
    });

    it('answers 400 for ranges that overlap, before anything is read', async () => {
      const { service, hotelsService, room } = setup();

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          {
            availability: [
              range('2026-12-07', '2026-12-12'),
              range('2026-12-01', '2026-12-08'),
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Availability ranges must not overlap: 2026-12-01 to 2026-12-08 and 2026-12-07 to 2026-12-12',
        ),
      );

      expect(hotelsService.findManagedEntityOrThrow).not.toHaveBeenCalled();
      expect(room!.save).not.toHaveBeenCalled();
    });

    it('counts booked nights and holds that have not expired as reserved', async () => {
      const { service, room, roomNights } = setup();
      const before = Date.now();

      await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { availability: [range('2026-12-01', '2026-12-08')] },
        USER_ID,
      );

      const filter = roomNights.find.mock.calls[0][0] as {
        roomId: Types.ObjectId;
        $or: [
          { state: RoomNightState },
          { state: RoomNightState; holdExpiresAt: { $gt: Date } },
        ];
      };
      expect(filter.roomId).toBe(room!._id);
      expect(filter.$or[0]).toEqual({ state: RoomNightState.Booked });
      expect(filter.$or[1].state).toBe(RoomNightState.Held);
      expect(filter.$or[1].holdExpiresAt.$gt.getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    it('keeps the ranges when every reserved night stays inside them', async () => {
      const { service, room } = setup({
        reservedNights: ['2026-12-03', '2026-12-04'],
      });

      await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { availability: [range('2026-12-03', '2026-12-05')] },
        USER_ID,
      );

      expect(room!.availability).toEqual([range('2026-12-03', '2026-12-05')]);
    });

    it('answers 409 and changes nothing when a reserved night would be left out', async () => {
      const { service, room } = setup({
        reservedNights: ['2026-12-03', '2026-12-04'],
      });

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { availability: [range('2026-12-01', '2026-12-04')] },
          USER_ID,
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Availability cannot be removed for nights with a reservation: 2026-12-04',
        ),
      );

      expect(room!.save).not.toHaveBeenCalled();
      expect(room!.availability).toEqual([range('2026-12-01', '2026-12-08')]);
    });

    it('treats the checkout boundary as outside the range', async () => {
      const { service } = setup({ reservedNights: ['2026-12-08'] });

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { availability: [range('2026-12-01', '2026-12-08')] },
          USER_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('answers 409 for an empty list when the room has a reservation', async () => {
      const { service } = setup({ reservedNights: ['2026-12-03'] });

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { availability: [] },
          USER_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('names five nights and counts the rest', async () => {
      const { service } = setup({
        reservedNights: [
          '2026-12-01',
          '2026-12-02',
          '2026-12-03',
          '2026-12-04',
          '2026-12-05',
          '2026-12-06',
          '2026-12-07',
        ],
      });

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { availability: [] },
          USER_ID,
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Availability cannot be removed for nights with a reservation: 2026-12-01, 2026-12-02, 2026-12-03, 2026-12-04, 2026-12-05 and 2 more',
        ),
      );
    });

    it('answers 404 for a room that is not in this hotel', async () => {
      const { service } = setup({ room: null });

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { availability: [] },
          USER_ID,
        ),
      ).rejects.toThrow(new NotFoundException('Room not found'));
    });

    it('answers 403 for a hotel the moderator does not manage', async () => {
      const { service, hotelsService } = setup();
      hotelsService.findManagedEntityOrThrow.mockRejectedValue(
        new ForbiddenException('You do not manage this hotel'),
      );

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { availability: [] },
          USER_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
