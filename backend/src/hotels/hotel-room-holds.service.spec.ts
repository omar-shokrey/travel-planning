import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import {
  HotelRoomHoldsService,
  ROOMS_TAKEN_MESSAGE,
} from './hotel-room-holds.service';
import { RoomNightState } from './models/room-night-state.enum';

const HOTEL_ID = new Types.ObjectId();
const STAY = { from: '2026-12-10', to: '2026-12-12' };

const freeRoom = (number: string, maxOccupancy = 2) => ({
  _id: new Types.ObjectId(),
  number,
  type: 'Double',
  beds: 2,
  maxOccupancy,
  pricePerNight: 10000,
});

/** A Mongoose query that resolves to `value`, with the chain the service uses. */
const query = <T>(value: T) => {
  const chain = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const setup = (
  options: {
    hotel?: object | null;
    known?: ReturnType<typeof freeRoom>[];
    free?: ReturnType<typeof freeRoom>[];
    insertError?: unknown;
  } = {},
) => {
  const hotel =
    options.hotel === undefined
      ? { _id: HOTEL_ID, name: 'Nile Hotel' }
      : options.hotel;
  const hotels = { findOne: jest.fn().mockReturnValue(query(hotel)) };
  const rooms = { find: jest.fn().mockReturnValue(query(options.known ?? [])) };
  const deleteExec = jest.fn().mockResolvedValue({ deletedCount: 0 });
  const roomNights = {
    deleteMany: jest.fn().mockReturnValue({ exec: deleteExec }),
    insertMany: jest.fn((nights: object[]) =>
      options.insertError
        ? Promise.reject(options.insertError)
        : Promise.resolve(nights),
    ),
  };
  const availableRooms = {
    assertStay: jest.fn(),
    findFreeRoomEntities: jest.fn().mockResolvedValue(options.free ?? []),
  };
  const service = new HotelRoomHoldsService(
    hotels as never,
    rooms as never,
    roomNights as never,
    availableRooms as unknown as HotelAvailableRoomsService,
  );
  return { service, hotels, rooms, roomNights, availableRooms };
};

describe('HotelRoomHoldsService', () => {
  describe('findBookableRooms (HTL-16)', () => {
    it('returns the hotel and the rooms in the order they were asked for', async () => {
      const a = freeRoom('101');
      const b = freeRoom('102');
      const { service, hotels, availableRooms } = setup({
        known: [a, b],
        free: [a, b],
      });

      const result = await service.findBookableRooms(
        HOTEL_ID.toString(),
        [
          { roomId: b._id.toString(), guests: 2 },
          { roomId: a._id.toString(), guests: 1 },
        ],
        STAY,
      );

      expect(availableRooms.assertStay).toHaveBeenCalledWith(STAY);
      expect(hotels.findOne).toHaveBeenCalledWith({
        _id: HOTEL_ID.toString(),
        active: true,
      });
      expect(result.hotel).toEqual({ _id: HOTEL_ID, name: 'Nile Hotel' });
      expect(result.rooms).toEqual([b, a]);
    });

    it('matches a room id written in capital letters', async () => {
      const a = freeRoom('101');
      const { service } = setup({ known: [a], free: [a] });

      const result = await service.findBookableRooms(
        HOTEL_ID.toString(),
        [{ roomId: a._id.toString().toUpperCase(), guests: 1 }],
        STAY,
      );

      expect(result.rooms).toEqual([a]);
    });

    it('stops at a stay the available rooms refuse', async () => {
      const { service, availableRooms, hotels } = setup();
      availableRooms.assertStay.mockImplementation(() => {
        throw new BadRequestException('past');
      });

      await expect(
        service.findBookableRooms(HOTEL_ID.toString(), [], STAY),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hotels.findOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a missing or deactivated hotel', async () => {
      const { service } = setup({ hotel: null });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [{ roomId: new Types.ObjectId().toString(), guests: 1 }],
          STAY,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 404 for a room of another hotel, naming it', async () => {
      const a = freeRoom('101');
      const stranger = new Types.ObjectId().toString();
      const { service, rooms } = setup({ known: [a], free: [a] });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [
            { roomId: a._id.toString(), guests: 1 },
            { roomId: stranger, guests: 1 },
          ],
          STAY,
        ),
      ).rejects.toThrow(
        new NotFoundException(
          `These rooms are not rooms of this hotel: ${stranger}`,
        ),
      );
      expect(rooms.find).toHaveBeenCalledWith({
        _id: { $in: [a._id, new Types.ObjectId(stranger)] },
        hotelId: HOTEL_ID,
      });
    });

    it('answers 400 when a room has more guests than it holds', async () => {
      const a = freeRoom('101', 2);
      const { service, availableRooms } = setup({ known: [a], free: [a] });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [{ roomId: a._id.toString(), guests: 3 }],
          STAY,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Too many guests for a room: room 101 holds at most 2',
        ),
      );
      expect(availableRooms.findFreeRoomEntities).not.toHaveBeenCalled();
    });

    it('answers 409 naming every room that is not free', async () => {
      const a = freeRoom('101');
      const b = freeRoom('102');
      const c = freeRoom('103');
      const { service } = setup({ known: [c, a, b], free: [b] });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [c, a, b].map((room) => ({ roomId: room._id.toString(), guests: 1 })),
          STAY,
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Not free for the whole stay: room 101, 103. Nothing was held.',
        ),
      );
    });
  });

  describe('hold (HTL-18)', () => {
    const bookingId = new Types.ObjectId();
    const holdExpiresAt = new Date('2026-12-01T10:10:00.000Z');

    it('first removes expired holds on those nights, then holds every night of every room', async () => {
      const a = new Types.ObjectId();
      const b = new Types.ObjectId();
      const { service, roomNights } = setup();

      await service.hold(HOTEL_ID, [a, b], STAY, bookingId, holdExpiresAt);

      expect(roomNights.deleteMany).toHaveBeenCalledWith({
        roomId: { $in: [a, b] },
        date: { $gte: '2026-12-10', $lt: '2026-12-12' },
        state: RoomNightState.Held,
        holdExpiresAt: { $lte: expect.any(Date) },
      });
      const nights = roomNights.insertMany.mock.calls[0][0] as unknown as {
        roomId: Types.ObjectId;
        date: string;
      }[];
      expect(
        nights.map((night) => [night.roomId.toString(), night.date]),
      ).toEqual([
        [a.toString(), '2026-12-10'],
        [a.toString(), '2026-12-11'],
        [b.toString(), '2026-12-10'],
        [b.toString(), '2026-12-11'],
      ]);
      expect(nights[0]).toEqual(
        expect.objectContaining({
          hotelId: HOTEL_ID,
          state: RoomNightState.Held,
          bookingId,
          holdExpiresAt,
        }),
      );
    });

    it('undoes its own nights and answers 409 when a night is taken', async () => {
      const { service, roomNights } = setup({
        insertError: { code: 11000 },
      });

      await expect(
        service.hold(
          HOTEL_ID,
          [new Types.ObjectId()],
          STAY,
          bookingId,
          holdExpiresAt,
        ),
      ).rejects.toThrow(new ConflictException(ROOMS_TAKEN_MESSAGE));

      const inserted = (
        roomNights.insertMany.mock.calls[0][0] as unknown as {
          _id: Types.ObjectId;
        }[]
      ).map((night) => night._id);
      expect(roomNights.deleteMany).toHaveBeenLastCalledWith({
        _id: { $in: inserted },
        bookingId,
        state: RoomNightState.Held,
      });
    });

    it('also undoes its own nights on any other error, and passes it on', async () => {
      const failure = new Error('network');
      const { service, roomNights } = setup({ insertError: failure });

      await expect(
        service.hold(
          HOTEL_ID,
          [new Types.ObjectId()],
          STAY,
          bookingId,
          holdExpiresAt,
        ),
      ).rejects.toBe(failure);
      expect(roomNights.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('release (HTL-18)', () => {
    it('deletes only the held nights of the reservation', async () => {
      const bookingId = new Types.ObjectId();
      const { service, roomNights } = setup();

      await service.release(bookingId);

      expect(roomNights.deleteMany).toHaveBeenCalledWith({
        bookingId,
        state: RoomNightState.Held,
      });
    });
  });
});
