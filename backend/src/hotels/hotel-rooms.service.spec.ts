import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { HotelRoomsService } from './hotel-rooms.service';
import type { HotelBookingLookup } from './hotel-booking-lookup.service';
import type { HotelsService } from './hotels.service';
import { RoomNightState } from './models/room-night-state.enum';
import { todayUtc } from './room-dates';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const ROOM_ID = '6740f1c2a4b5c6d7e8f90124';
const USER_ID = '6740f1c2a4b5c6d7e8f90125';

const range = (from: string, to: string) => ({ from, to });

/** A stored room with `set` and `save`, as much as the service uses. */
const storedRoom = (fields: { active?: boolean } = {}) => {
  const room = {
    _id: new Types.ObjectId(ROOM_ID),
    hotelId: new Types.ObjectId(HOTEL_ID),
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 12500,
    active: fields.active ?? true,
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

/** A Mongoose query that resolves to `value`, with the chain the service uses. */
const query = <T>(value: T) => {
  const chain = {
    select: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.select.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const blockedNight = (date: string) => ({ _id: new Types.ObjectId(), date });

const setup = (
  options: {
    room?: ReturnType<typeof storedRoom> | null;
    reservedNights?: string[];
    blockedNights?: { _id: Types.ObjectId; date: string }[];
    everReserved?: boolean;
    /** A reservation names the room, but none of its nights is stored (HTL-18). */
    inAReservation?: boolean;
  } = {},
) => {
  const room = options.room === undefined ? storedRoom() : options.room;
  const hotel = { _id: new Types.ObjectId(HOTEL_ID) };
  const reserved = (options.reservedNights ?? []).map((date) => ({ date }));
  const blocked = options.blockedNights ?? [];

  const rooms = {
    findOne: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(room) }),
    deleteOne: jest.fn().mockReturnValue(query({ deletedCount: 1 })),
  };
  const roomNights = {
    // A filter on `state: blocked` reads the blocks; any other reads the
    // nights that reservations have.
    find: jest.fn((filter: { state?: RoomNightState }) =>
      query(filter.state === RoomNightState.Blocked ? blocked : reserved),
    ),
    exists: jest
      .fn()
      .mockReturnValue(
        query(options.everReserved ? { _id: new Types.ObjectId() } : null),
      ),
    insertMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockReturnValue(query({ deletedCount: 0 })),
  };
  const hotelsService = {
    findManagedEntityOrThrow: jest.fn().mockResolvedValue(hotel),
  };

  const bookingLookup = {
    wasEverReserved: jest
      .fn()
      .mockResolvedValue(options.inAReservation ?? false),
  };

  const service = new HotelRoomsService(
    rooms as never,
    roomNights as never,
    hotelsService as unknown as HotelsService,
    bookingLookup as unknown as HotelBookingLookup,
  );
  return {
    service,
    room,
    hotel,
    rooms,
    roomNights,
    hotelsService,
    bookingLookup,
  };
};

type InsertedNight = { _id: Types.ObjectId; date: string; state: string };

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
        blocked: [],
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

    it('writes no room night when the price changes', async () => {
      const { service, roomNights } = setup();

      await service.update(HOTEL_ID, ROOM_ID, { pricePerNight: 9900 }, USER_ID);

      expect(roomNights.insertMany).not.toHaveBeenCalled();
      expect(roomNights.deleteMany).not.toHaveBeenCalled();
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

  describe('setAvailability: the bookable ranges (HTL-05)', () => {
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

    it('leaves the blocks alone when only the availability is sent', async () => {
      const { service, roomNights } = setup();

      await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { availability: [range('2026-12-01', '2026-12-08')] },
        USER_ID,
      );

      expect(roomNights.insertMany).not.toHaveBeenCalled();
      expect(roomNights.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 400 when neither list was sent, before anything is read', async () => {
      const { service, hotelsService } = setup();

      await expect(
        service.setAvailability(HOTEL_ID, ROOM_ID, {}, USER_ID),
      ).rejects.toThrow(
        new BadRequestException('Send availability, blocked or both'),
      );

      expect(hotelsService.findManagedEntityOrThrow).not.toHaveBeenCalled();
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

      const filter = roomNights.find.mock.calls[0][0] as unknown as {
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
  });

  describe('setAvailability: the blocked ranges (HTL-06)', () => {
    it('inserts one blocked night per night of the ranges and returns them as ranges', async () => {
      const { service, roomNights, room } = setup();
      roomNights.find.mockImplementation((filter: { state?: RoomNightState }) =>
        query(
          filter.state === RoomNightState.Blocked
            ? roomNights.insertMany.mock.calls.length > 0
              ? [blockedNight('2026-12-10'), blockedNight('2026-12-11')]
              : []
            : [],
        ),
      );

      const result = await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { blocked: [range('2026-12-10', '2026-12-12')] },
        USER_ID,
      );

      const inserted = roomNights.insertMany.mock
        .calls[0][0] as InsertedNight[];
      expect(inserted.map((night) => night.date)).toEqual([
        '2026-12-10',
        '2026-12-11',
      ]);
      expect(inserted[0]).toMatchObject({
        roomId: room!._id,
        hotelId: room!.hotelId,
        state: RoomNightState.Blocked,
      });
      expect(result.blocked).toEqual([range('2026-12-10', '2026-12-12')]);
      expect(room!.save).not.toHaveBeenCalled();
    });

    it('adds only the new nights and removes the blocks that are no longer wanted', async () => {
      const kept = blockedNight('2026-12-10');
      const dropped = blockedNight('2026-12-20');
      const { service, roomNights } = setup({ blockedNights: [kept, dropped] });

      await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { blocked: [range('2026-12-10', '2026-12-12')] },
        USER_ID,
      );

      const inserted = roomNights.insertMany.mock
        .calls[0][0] as InsertedNight[];
      expect(inserted.map((night) => night.date)).toEqual(['2026-12-11']);
      expect(roomNights.deleteMany).toHaveBeenLastCalledWith({
        _id: { $in: [dropped._id] },
        state: RoomNightState.Blocked,
      });
    });

    it('removes every block with an empty list', async () => {
      const first = blockedNight('2026-12-10');
      const second = blockedNight('2026-12-11');
      const { service, roomNights } = setup({ blockedNights: [first, second] });

      await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { blocked: [] },
        USER_ID,
      );

      expect(roomNights.insertMany).not.toHaveBeenCalled();
      expect(roomNights.deleteMany).toHaveBeenCalledWith({
        _id: { $in: [first._id, second._id] },
        state: RoomNightState.Blocked,
      });
    });

    it('removes expired holds on the new nights before blocking them', async () => {
      const { service, roomNights, room } = setup();

      await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        { blocked: [range('2026-12-10', '2026-12-11')] },
        USER_ID,
      );

      const filter = roomNights.deleteMany.mock.calls[0][0] as {
        roomId: Types.ObjectId;
        date: { $in: string[] };
        state: RoomNightState;
        holdExpiresAt: { $lte: Date };
      };
      expect(filter.roomId).toBe(room!._id);
      expect(filter.date).toEqual({ $in: ['2026-12-10'] });
      expect(filter.state).toBe(RoomNightState.Held);
      expect(filter.holdExpiresAt.$lte).toBeInstanceOf(Date);
    });

    it('answers 409 and inserts nothing when a range covers a reserved night', async () => {
      const { service, roomNights } = setup({
        reservedNights: ['2026-12-11'],
      });

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { blocked: [range('2026-12-10', '2026-12-12')] },
          USER_ID,
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Nights with a reservation cannot be blocked: 2026-12-11',
        ),
      );

      expect(roomNights.insertMany).not.toHaveBeenCalled();
    });

    it('undoes its own inserts and answers 409 when a reservation takes a night meanwhile', async () => {
      const { service, roomNights } = setup();
      roomNights.insertMany.mockRejectedValue(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { blocked: [range('2026-12-10', '2026-12-12')] },
          USER_ID,
        ),
      ).rejects.toThrow(ConflictException);

      const inserted = roomNights.insertMany.mock
        .calls[0][0] as InsertedNight[];
      expect(roomNights.deleteMany).toHaveBeenLastCalledWith({
        _id: { $in: inserted.map((night) => night._id) },
        state: RoomNightState.Blocked,
      });
    });

    it('passes on a database error that is not a duplicate', async () => {
      const { service, roomNights } = setup();
      const failure = new Error('connection lost');
      roomNights.insertMany.mockRejectedValue(failure);

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { blocked: [range('2026-12-10', '2026-12-12')] },
          USER_ID,
        ),
      ).rejects.toBe(failure);
    });

    it('answers 400 for blocked ranges that overlap', async () => {
      const { service, hotelsService } = setup();

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          {
            blocked: [
              range('2026-12-10', '2026-12-15'),
              range('2026-12-14', '2026-12-16'),
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Blocked ranges must not overlap: 2026-12-10 to 2026-12-15 and 2026-12-14 to 2026-12-16',
        ),
      );

      expect(hotelsService.findManagedEntityOrThrow).not.toHaveBeenCalled();
    });

    it('answers 400 for more than 366 blocked nights in one request', async () => {
      const { service, hotelsService } = setup();

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          { blocked: [range('2027-01-01', '2028-01-03')] },
          USER_ID,
        ),
      ).rejects.toThrow(
        new BadRequestException('A request can block at most 366 nights'),
      );

      expect(hotelsService.findManagedEntityOrThrow).not.toHaveBeenCalled();
    });

    it('checks the availability before writing any block when both lists are sent', async () => {
      const { service, roomNights, room } = setup({
        reservedNights: ['2026-12-03'],
      });

      await expect(
        service.setAvailability(
          HOTEL_ID,
          ROOM_ID,
          {
            availability: [],
            blocked: [range('2026-12-10', '2026-12-12')],
          },
          USER_ID,
        ),
      ).rejects.toThrow(ConflictException);

      expect(roomNights.insertMany).not.toHaveBeenCalled();
      expect(room!.save).not.toHaveBeenCalled();
    });

    it('saves both lists when both are valid', async () => {
      const { service, roomNights, room } = setup();

      await service.setAvailability(
        HOTEL_ID,
        ROOM_ID,
        {
          availability: [range('2026-12-01', '2026-12-31')],
          blocked: [range('2026-12-10', '2026-12-11')],
        },
        USER_ID,
      );

      expect(roomNights.insertMany).toHaveBeenCalledTimes(1);
      expect(room!.save).toHaveBeenCalledTimes(1);
      expect(room!.availability).toEqual([range('2026-12-01', '2026-12-31')]);
    });
  });

  describe('deactivate (HTL-06)', () => {
    it('deactivates a room without upcoming reservations', async () => {
      const { service, room } = setup();

      const result = await service.deactivate(HOTEL_ID, ROOM_ID, USER_ID);

      expect(room!.active).toBe(false);
      expect(room!.save).toHaveBeenCalledTimes(1);
      expect(result.active).toBe(false);
    });

    it('ignores reserved nights that are already in the past', async () => {
      const { service, room } = setup({ reservedNights: ['2020-01-01'] });

      await service.deactivate(HOTEL_ID, ROOM_ID, USER_ID);

      expect(room!.active).toBe(false);
    });

    it('answers 409 for a room with a reserved night from today on', async () => {
      const today = todayUtc();
      const { service, room } = setup({ reservedNights: [today] });

      await expect(
        service.deactivate(HOTEL_ID, ROOM_ID, USER_ID),
      ).rejects.toThrow(
        new ConflictException(
          `A room with upcoming reservations cannot be deactivated: ${today}`,
        ),
      );

      expect(room!.save).not.toHaveBeenCalled();
      expect(room!.active).toBe(true);
    });

    it('answers 409 for a room that is already deactivated', async () => {
      const { service, room } = setup({ room: storedRoom({ active: false }) });

      await expect(
        service.deactivate(HOTEL_ID, ROOM_ID, USER_ID),
      ).rejects.toThrow(
        new ConflictException('The room is already deactivated'),
      );

      expect(room!.save).not.toHaveBeenCalled();
    });

    it('answers 403 for a hotel the moderator does not manage', async () => {
      const { service, hotelsService } = setup();
      hotelsService.findManagedEntityOrThrow.mockRejectedValue(
        new ForbiddenException('You do not manage this hotel'),
      );

      await expect(
        service.deactivate(HOTEL_ID, ROOM_ID, USER_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reactivate (HTL-06)', () => {
    it('makes a deactivated room active again', async () => {
      const { service, room } = setup({ room: storedRoom({ active: false }) });

      const result = await service.reactivate(HOTEL_ID, ROOM_ID, USER_ID);

      expect(room!.active).toBe(true);
      expect(room!.save).toHaveBeenCalledTimes(1);
      expect(result.active).toBe(true);
    });

    it('answers 409 for a room that is already active', async () => {
      const { service, room } = setup();

      await expect(
        service.reactivate(HOTEL_ID, ROOM_ID, USER_ID),
      ).rejects.toThrow(new ConflictException('The room is already active'));

      expect(room!.save).not.toHaveBeenCalled();
    });
  });

  describe('remove (HTL-06)', () => {
    it('deletes a room that was never reserved, with its blocks', async () => {
      const { service, room, rooms, roomNights, bookingLookup } = setup();

      await service.remove(HOTEL_ID, ROOM_ID, USER_ID);

      expect(roomNights.exists).toHaveBeenCalledWith({
        roomId: room!._id,
        bookingId: { $exists: true },
      });
      expect(bookingLookup.wasEverReserved).toHaveBeenCalledWith(
        room!.hotelId,
        room!._id,
      );
      expect(roomNights.deleteMany).toHaveBeenCalledWith({
        roomId: room!._id,
        state: RoomNightState.Blocked,
      });
      expect(rooms.deleteOne).toHaveBeenCalledWith({ _id: room!._id });
    });

    it('answers 409 and deletes nothing for a room that has been reserved', async () => {
      const { service, rooms, roomNights, bookingLookup } = setup({
        everReserved: true,
      });

      await expect(service.remove(HOTEL_ID, ROOM_ID, USER_ID)).rejects.toThrow(
        new ConflictException(
          'A room that has been reserved cannot be deleted. Deactivate it instead.',
        ),
      );

      // A stored night already answers: the reservations are not read.
      expect(bookingLookup.wasEverReserved).not.toHaveBeenCalled();
      expect(roomNights.deleteMany).not.toHaveBeenCalled();
      expect(rooms.deleteOne).not.toHaveBeenCalled();
    });

    it('answers 409 for a room of an expired reservation whose nights were released (HTL-18)', async () => {
      const { service, rooms, roomNights } = setup({ inAReservation: true });

      await expect(service.remove(HOTEL_ID, ROOM_ID, USER_ID)).rejects.toThrow(
        new ConflictException(
          'A room that has been reserved cannot be deleted. Deactivate it instead.',
        ),
      );

      expect(roomNights.deleteMany).not.toHaveBeenCalled();
      expect(rooms.deleteOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a room that is not in this hotel', async () => {
      const { service, rooms } = setup({ room: null });

      await expect(service.remove(HOTEL_ID, ROOM_ID, USER_ID)).rejects.toThrow(
        new NotFoundException('Room not found'),
      );

      expect(rooms.deleteOne).not.toHaveBeenCalled();
    });

    it('answers 403 and deletes nothing for a hotel the moderator does not manage', async () => {
      const { service, hotelsService, rooms } = setup();
      hotelsService.findManagedEntityOrThrow.mockRejectedValue(
        new ForbiddenException('You do not manage this hotel'),
      );

      await expect(service.remove(HOTEL_ID, ROOM_ID, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );

      expect(rooms.deleteOne).not.toHaveBeenCalled();
    });
  });
});
