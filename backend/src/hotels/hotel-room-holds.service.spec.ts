import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  HotelRoomHoldsService,
  ROOMS_TAKEN_MESSAGE,
} from './hotel-room-holds.service';
import { RoomNightState } from './models/room-night-state.enum';

const HOTEL_ID = new Types.ObjectId();
/** Far in the future, so "check-in in the past" never trips. */
const STAY = { from: '2099-12-10', to: '2099-12-12' };
const NOW = new Date('2099-01-01T10:00:00.000Z');
const OPEN = { from: '2099-12-01', to: '2100-01-01' };

const room = (
  number: string,
  fields: { maxOccupancy?: number; availability?: object[] } = {},
) => ({
  _id: new Types.ObjectId(),
  number,
  type: 'Double',
  maxOccupancy: fields.maxOccupancy ?? 2,
  pricePerNight: 10000,
  availability: fields.availability ?? [OPEN],
});

const night = (
  roomId: Types.ObjectId,
  date: string,
  state: RoomNightState,
  holdExpiresAt?: Date,
) => ({ roomId, date, state, ...(holdExpiresAt && { holdExpiresAt }) });

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

/**
 * `roomFinds` are the results of the successive `rooms.find` calls:
 * `findBookableRooms` reads the rooms asked for, then those that can be free;
 * `hold` reads the rooms once more at the end.
 */
const setup = (
  options: {
    hotel?: object | null;
    hotelActive?: boolean;
    roomFinds?: object[][];
    nights?: object[];
    insertError?: unknown;
  } = {},
) => {
  const hotel =
    options.hotel === undefined
      ? { _id: HOTEL_ID, name: 'Nile Hotel' }
      : options.hotel;
  const hotels = {
    findOne: jest.fn().mockReturnValue(query(hotel)),
    exists: jest
      .fn()
      .mockReturnValue(
        query(options.hotelActive === false ? null : { _id: HOTEL_ID }),
      ),
  };
  const rooms = { find: jest.fn() };
  for (const result of options.roomFinds ?? []) {
    rooms.find.mockReturnValueOnce(query(result));
  }
  const deleteExec = jest.fn().mockResolvedValue({ deletedCount: 0 });
  const roomNights = {
    find: jest.fn().mockReturnValue(query(options.nights ?? [])),
    deleteMany: jest.fn().mockReturnValue({ exec: deleteExec }),
    insertMany: jest.fn((nights: object[]) =>
      options.insertError
        ? Promise.reject(options.insertError)
        : Promise.resolve(nights),
    ),
  };
  const service = new HotelRoomHoldsService(
    hotels as never,
    rooms as never,
    roomNights as never,
  );
  return { service, hotels, rooms, roomNights };
};

describe('HotelRoomHoldsService', () => {
  describe('findBookableRooms (HTL-16)', () => {
    it('returns the hotel and the rooms in the order they were asked for', async () => {
      const a = room('101');
      const b = room('102');
      const { service, hotels, rooms } = setup({
        roomFinds: [
          [a, b],
          [a, b],
        ],
      });

      const result = await service.findBookableRooms(
        HOTEL_ID.toString(),
        [
          { roomId: b._id.toString(), guests: 2 },
          { roomId: a._id.toString(), guests: 1 },
        ],
        STAY,
        NOW,
      );

      expect(hotels.findOne).toHaveBeenCalledWith({
        _id: HOTEL_ID.toString(),
        active: true,
      });
      expect(result.hotel).toEqual({ _id: HOTEL_ID, name: 'Nile Hotel' });
      expect(result.rooms).toEqual([b, a]);
      // The second read is the free-room rule of hotel search: active rooms
      // bookable on the first night.
      expect(rooms.find).toHaveBeenLastCalledWith({
        _id: { $in: [b._id, a._id] },
        hotelId: HOTEL_ID,
        active: true,
        availability: {
          $elemMatch: { from: { $lte: STAY.from }, to: { $gt: STAY.from } },
        },
      });
    });

    it('matches a room id written in capital letters', async () => {
      const a = room('101');
      const { service } = setup({ roomFinds: [[a], [a]] });

      const result = await service.findBookableRooms(
        HOTEL_ID.toString(),
        [{ roomId: a._id.toString().toUpperCase(), guests: 1 }],
        STAY,
        NOW,
      );

      expect(result.rooms).toEqual([a]);
    });

    it('stops at a check-in in the past, before any read', async () => {
      const { service, hotels } = setup();

      const error: unknown = await service
        .findBookableRooms(
          HOTEL_ID.toString(),
          [],
          { from: '2020-01-01', to: '2020-01-03' },
          NOW,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: 'Validation failed',
        errors: [{ field: 'checkIn' }],
      });
      expect(hotels.findOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a missing or deactivated hotel', async () => {
      const { service, rooms } = setup({ hotel: null });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [{ roomId: new Types.ObjectId().toString(), guests: 1 }],
          STAY,
          NOW,
        ),
      ).rejects.toThrow(new NotFoundException('Hotel not found'));
      expect(rooms.find).not.toHaveBeenCalled();
    });

    it('answers 404 for a room of another hotel, naming it', async () => {
      const a = room('101');
      const stranger = new Types.ObjectId().toString();
      const { service, rooms } = setup({ roomFinds: [[a]] });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [
            { roomId: a._id.toString(), guests: 1 },
            { roomId: stranger, guests: 1 },
          ],
          STAY,
          NOW,
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

    it('answers 400 when a room has more guests than it holds, before the free check', async () => {
      const a = room('101', { maxOccupancy: 2 });
      const { service, rooms } = setup({ roomFinds: [[a]] });

      const error: unknown = await service
        .findBookableRooms(
          HOTEL_ID.toString(),
          [{ roomId: a._id.toString(), guests: 3 }],
          STAY,
          NOW,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: 'Validation failed',
        errors: [
          {
            field: 'rooms',
            messages: ['Too many guests for a room: room 101 holds at most 2'],
          },
        ],
      });
      expect(rooms.find).toHaveBeenCalledTimes(1);
    });

    it('answers 409 naming every room that is not free, and holds nothing', async () => {
      const a = room('101');
      const b = room('102');
      const c = room('103');
      // 101 has a booked night, 103 is not bookable on the first night
      // (inactive, or outside its availability): it is not even a candidate.
      const { service, roomNights } = setup({
        roomFinds: [
          [c, a, b],
          [a, b],
        ],
        nights: [night(a._id, '2099-12-11', RoomNightState.Booked)],
      });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [c, a, b].map((item) => ({
            roomId: item._id.toString(),
            guests: 1,
          })),
          STAY,
          NOW,
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Not free for the whole stay: room 101, 103. Nothing was held.',
        ),
      );
      expect(roomNights.insertMany).not.toHaveBeenCalled();
    });

    it('does not read nights when no room can be free at all', async () => {
      const a = room('101');
      const { service, roomNights } = setup({ roomFinds: [[a], []] });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [{ roomId: a._id.toString(), guests: 1 }],
          STAY,
          NOW,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(roomNights.find).not.toHaveBeenCalled();
    });

    it.each([
      [
        'blocked',
        (id: Types.ObjectId) => night(id, '2099-12-10', RoomNightState.Blocked),
      ],
      [
        'held by a hold that has not expired',
        (id: Types.ObjectId) =>
          night(
            id,
            '2099-12-11',
            RoomNightState.Held,
            new Date('2099-01-01T10:05:00.000Z'),
          ),
      ],
    ])('refuses a room with a night that is %s', async (_label, taken) => {
      const a = room('101');
      const { service } = setup({
        roomFinds: [[a], [a]],
        nights: [taken(a._id)],
      });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [{ roomId: a._id.toString(), guests: 1 }],
          STAY,
          NOW,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a room whose night is held by a hold that has expired', async () => {
      const a = room('101');
      const { service } = setup({
        roomFinds: [[a], [a]],
        nights: [
          night(
            a._id,
            '2099-12-10',
            RoomNightState.Held,
            new Date('2099-01-01T09:59:00.000Z'),
          ),
        ],
      });

      const result = await service.findBookableRooms(
        HOTEL_ID.toString(),
        [{ roomId: a._id.toString(), guests: 1 }],
        STAY,
        NOW,
      );

      expect(result.rooms).toEqual([a]);
    });

    it('refuses a room whose availability misses the last night', async () => {
      const a = room('101', {
        availability: [{ from: '2099-12-01', to: '2099-12-11' }],
      });
      const { service } = setup({ roomFinds: [[a], [a]] });

      await expect(
        service.findBookableRooms(
          HOTEL_ID.toString(),
          [{ roomId: a._id.toString(), guests: 1 }],
          STAY,
          NOW,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('hold (HTL-18)', () => {
    const bookingId = new Types.ObjectId();
    const holdExpiresAt = new Date('2099-01-01T10:10:00.000Z');

    it('first removes expired holds on those nights, then holds every night of every room', async () => {
      const a = room('101');
      const b = room('102');
      const { service, roomNights } = setup({ roomFinds: [[a, b]] });

      await service.hold(
        HOTEL_ID,
        [a._id, b._id],
        STAY,
        bookingId,
        holdExpiresAt,
        NOW,
      );

      expect(roomNights.deleteMany).toHaveBeenCalledWith({
        roomId: { $in: [a._id, b._id] },
        date: { $gte: '2099-12-10', $lt: '2099-12-12' },
        state: RoomNightState.Held,
        holdExpiresAt: { $lte: NOW },
      });
      const nights = roomNights.insertMany.mock.calls[0][0] as unknown as {
        roomId: Types.ObjectId;
        date: string;
      }[];
      expect(nights.map((item) => [item.roomId.toString(), item.date])).toEqual(
        [
          [a._id.toString(), '2099-12-10'],
          [a._id.toString(), '2099-12-11'],
          [b._id.toString(), '2099-12-10'],
          [b._id.toString(), '2099-12-11'],
        ],
      );
      expect(nights[0]).toEqual(
        expect.objectContaining({
          hotelId: HOTEL_ID,
          state: RoomNightState.Held,
          bookingId,
          holdExpiresAt,
        }),
      );
    });

    it('does not release anything when the hold and the check afterwards succeed', async () => {
      const a = room('101');
      const { service, roomNights } = setup({ roomFinds: [[a]] });

      await service.hold(
        HOTEL_ID,
        [a._id],
        STAY,
        bookingId,
        holdExpiresAt,
        NOW,
      );

      // Only the removal of expired holds before the insert.
      expect(roomNights.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('undoes its own nights and answers 409 when a night is taken', async () => {
      const { service, roomNights, hotels } = setup({
        insertError: { code: 11000 },
      });

      await expect(
        service.hold(
          HOTEL_ID,
          [new Types.ObjectId()],
          STAY,
          bookingId,
          holdExpiresAt,
          NOW,
        ),
      ).rejects.toThrow(new ConflictException(ROOMS_TAKEN_MESSAGE));

      const inserted = (
        roomNights.insertMany.mock.calls[0][0] as unknown as {
          _id: Types.ObjectId;
        }[]
      ).map((item) => item._id);
      expect(roomNights.deleteMany).toHaveBeenLastCalledWith({
        _id: { $in: inserted },
        bookingId,
        state: RoomNightState.Held,
      });
      // The check afterwards is not reached.
      expect(hotels.exists).not.toHaveBeenCalled();
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
          NOW,
        ),
      ).rejects.toBe(failure);
      expect(roomNights.deleteMany).toHaveBeenCalledTimes(2);
    });

    describe('the check after the nights are written', () => {
      const released = (roomNights: { deleteMany: jest.Mock }) =>
        expect(roomNights.deleteMany).toHaveBeenLastCalledWith({
          bookingId,
          state: RoomNightState.Held,
        });

      it('releases only its own nights and answers 409 when the hotel was deactivated', async () => {
        const a = room('101');
        const { service, roomNights } = setup({
          hotelActive: false,
          roomFinds: [[a]],
        });

        await expect(
          service.hold(HOTEL_ID, [a._id], STAY, bookingId, holdExpiresAt, NOW),
        ).rejects.toThrow(new ConflictException(ROOMS_TAKEN_MESSAGE));
        released(roomNights);
      });

      it('releases and answers 409 when a room was deleted or deactivated', async () => {
        const a = room('101');
        const b = room('102');
        // The second room is no longer returned: deleted, or not active.
        const { service, roomNights, rooms } = setup({ roomFinds: [[a]] });

        await expect(
          service.hold(
            HOTEL_ID,
            [a._id, b._id],
            STAY,
            bookingId,
            holdExpiresAt,
            NOW,
          ),
        ).rejects.toThrow(new ConflictException(ROOMS_TAKEN_MESSAGE));
        released(roomNights);
        expect(rooms.find).toHaveBeenCalledWith({
          _id: { $in: [a._id, b._id] },
          hotelId: HOTEL_ID,
          active: true,
          availability: {
            $elemMatch: { from: { $lte: STAY.from }, to: { $gt: STAY.from } },
          },
        });
      });

      it('releases and answers 409 when the availability no longer covers a night', async () => {
        const cut = room('101', {
          availability: [{ from: '2099-12-01', to: '2099-12-11' }],
        });
        const { service, roomNights } = setup({ roomFinds: [[cut]] });

        await expect(
          service.hold(
            HOTEL_ID,
            [cut._id],
            STAY,
            bookingId,
            holdExpiresAt,
            NOW,
          ),
        ).rejects.toThrow(new ConflictException(ROOMS_TAKEN_MESSAGE));
        released(roomNights);
      });

      it('releases and passes the error on when the check itself fails', async () => {
        const failure = new Error('network');
        const a = room('101');
        const { service, roomNights, hotels } = setup({ roomFinds: [[a]] });
        hotels.exists.mockReturnValue({
          exec: jest.fn().mockRejectedValue(failure),
        });

        await expect(
          service.hold(HOTEL_ID, [a._id], STAY, bookingId, holdExpiresAt, NOW),
        ).rejects.toBe(failure);
        released(roomNights);
      });
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

describe('HotelRoomHoldsService: confirming a paid reservation (HTL-17)', () => {
  const bookingId = new Types.ObjectId();
  const setupNights = (modifiedCount: number) => {
    const roomNights = {
      updateMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount }),
      }),
    };
    const service = new HotelRoomHoldsService(
      {} as never,
      {} as never,
      roomNights as never,
    );
    return { service, roomNights };
  };

  it('secureHold keeps only the live held nights of the reservation, until the given moment', async () => {
    const { service, roomNights } = setupNights(6);
    const now = new Date('2027-06-01T10:00:00.000Z');
    const until = new Date('2027-06-01T10:30:00.000Z');

    await expect(service.secureHold(bookingId, until, now)).resolves.toBe(6);

    expect(roomNights.updateMany).toHaveBeenCalledWith(
      {
        bookingId,
        state: RoomNightState.Held,
        holdExpiresAt: { $gt: now },
      },
      { $set: { holdExpiresAt: until } },
    );
  });

  it('confirm turns only the held nights of the reservation into booked nights with no hold end', async () => {
    const { service, roomNights } = setupNights(6);

    await expect(service.confirm(bookingId)).resolves.toBe(6);

    expect(roomNights.updateMany).toHaveBeenCalledWith(
      { bookingId, state: RoomNightState.Held },
      {
        $set: { state: RoomNightState.Booked },
        $unset: { holdExpiresAt: '' },
      },
    );
  });

  it('confirm reports 0 when there is nothing left to change (a repeated call)', async () => {
    const { service } = setupNights(0);

    await expect(service.confirm(bookingId)).resolves.toBe(0);
  });
});
