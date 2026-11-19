import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import type { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { ROOM_QUERY_MAX_NIGHTS } from './hotels.constants';
import { RoomNightState } from './models/room-night-state.enum';
import { todayUtc } from './room-dates';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const HOTEL_OID = new Types.ObjectId(HOTEL_ID);

/** A fixed "now", so the hold tests never depend on the clock. */
const NOW = new Date('2099-03-01T12:00:00.000Z');

/** Dates far in the future, so "check-in in the past" never trips. */
const OPEN = { from: '2099-03-01', to: '2099-04-01' };
const STAY = { from: '2099-03-10', to: '2099-03-13' };

interface StoredRoom {
  _id: Types.ObjectId;
  number: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
  availability: { from: string; to: string }[];
}

const storedRoom = (
  number: string,
  fields: Partial<StoredRoom> = {},
): StoredRoom => ({
  _id: new Types.ObjectId(),
  number,
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
  availability: [OPEN],
  ...fields,
});

interface StoredNight {
  roomId: Types.ObjectId;
  date: string;
  state: RoomNightState;
  holdExpiresAt?: Date;
}

const night = (
  room: StoredRoom,
  date: string,
  state: RoomNightState,
  holdExpiresAt?: Date,
): StoredNight => ({ roomId: room._id, date, state, holdExpiresAt });

/** A Mongoose query that resolves to `value`, with the chain the service uses. */
const chain = <T>(value: T) => {
  const query = {
    select: jest.fn(),
    collation: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const step of ['select', 'collation', 'sort', 'lean'] as const) {
    query[step].mockReturnValue(query);
  }
  return query;
};

const pageQuery = (
  checkIn = STAY.from,
  checkOut = STAY.to,
  page = 1,
  limit = 10,
): AvailableRoomsQueryDto =>
  ({
    checkIn,
    checkOut,
    page,
    limit,
    skip: (page - 1) * limit,
  }) as AvailableRoomsQueryDto;

/**
 * The rooms are returned as the database would after its filter and sort, so
 * each test lists them in room-number order. The service still applies the
 * whole rule to them in memory.
 */
const setup = (
  options: {
    hotel?: boolean;
    rooms?: StoredRoom[];
    nights?: StoredNight[];
  } = {},
) => {
  const hotelFound = options.hotel ?? true;
  const roomQuery = chain(options.rooms ?? []);
  const nightQuery = chain(options.nights ?? []);
  const hotels = {
    exists: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(hotelFound ? { _id: HOTEL_OID } : null),
    }),
  };
  const rooms = { find: jest.fn().mockReturnValue(roomQuery) };
  const roomNights = { find: jest.fn().mockReturnValue(nightQuery) };
  const service = new HotelAvailableRoomsService(
    hotels as never,
    rooms as never,
    roomNights as never,
  );
  return { service, hotels, rooms, roomNights, roomQuery, nightQuery };
};

/** The numbers of the rooms listed for the stay. */
const freeNumbers = async (
  rooms: StoredRoom[],
  nights: StoredNight[] = [],
  stay = STAY,
): Promise<string[]> => {
  const { service } = setup({ rooms, nights });
  const list = await service.listAvailable(HOTEL_OID, stay, NOW);
  return list.map((room) => room.number);
};

describe('HotelAvailableRoomsService (HTL-15)', () => {
  describe('findAvailable', () => {
    it('answers 404 for a hotel that does not exist or is deactivated (ACC-15)', async () => {
      const { service, hotels, rooms } = setup({ hotel: false });

      await expect(
        service.findAvailable(HOTEL_ID, pageQuery(), NOW),
      ).rejects.toThrow(new NotFoundException('Hotel not found'));
      // One query finds both cases: a deactivated hotel is not `active: true`.
      expect(hotels.exists).toHaveBeenCalledWith({
        _id: HOTEL_ID,
        active: true,
      });
      expect(rooms.find).not.toHaveBeenCalled();
    });

    it('answers an empty page for a hotel with no free room', async () => {
      const { service, roomNights } = setup({ rooms: [] });

      await expect(
        service.findAvailable(HOTEL_ID, pageQuery(), NOW),
      ).resolves.toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
      expect(roomNights.find).not.toHaveBeenCalled();
    });

    it('returns each free room with type, beds, occupancy, price per night and total stay price', async () => {
      const room = storedRoom('101', {
        type: 'Suite',
        beds: 3,
        maxOccupancy: 5,
        pricePerNight: 12550,
      });
      const { service } = setup({ rooms: [room] });

      const page = await service.findAvailable(HOTEL_ID, pageQuery(), NOW);

      expect(page.items).toEqual([
        {
          id: room._id.toString(),
          number: '101',
          type: 'Suite',
          beds: 3,
          maxOccupancy: 5,
          pricePerNight: 12550,
          nights: 3,
          totalPrice: 37650,
          currency: 'USD',
        },
      ]);
    });

    it('pages the free rooms and counts all of them', async () => {
      const rooms = ['1', '2', '3', '4', '5'].map((n) => storedRoom(n));
      const taken = [night(rooms[1], '2099-03-11', RoomNightState.Booked)];
      const { service } = setup({ rooms, nights: taken });

      const page = await service.findAvailable(
        HOTEL_ID,
        pageQuery(STAY.from, STAY.to, 2, 2),
        NOW,
      );

      expect(page.items.map((room) => room.number)).toEqual(['4', '5']);
      expect(page.meta).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });
    });

    it('answers a page past the end with no items and the right total', async () => {
      const { service } = setup({ rooms: [storedRoom('1')] });

      const page = await service.findAvailable(
        HOTEL_ID,
        pageQuery(STAY.from, STAY.to, 3, 10),
        NOW,
      );

      expect(page).toEqual({
        items: [],
        meta: { page: 3, limit: 10, total: 1, totalPages: 1 },
      });
    });

    it.each([
      [
        'a check-in in the past',
        { from: '2020-01-01', to: '2020-01-03' },
        'checkIn',
        'checkIn cannot be in the past',
      ],
      [
        `a stay of more than ${ROOM_QUERY_MAX_NIGHTS} nights`,
        { from: '2099-01-01', to: '2100-01-03' },
        'checkOut',
        `A stay can have at most ${ROOM_QUERY_MAX_NIGHTS} nights`,
      ],
    ])(
      'answers 400 naming the field for %s, before it reads anything',
      async (_label, stay, field, message) => {
        const { service, hotels } = setup();

        const error = await service
          .findAvailable(HOTEL_ID, pageQuery(stay.from, stay.to), NOW)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          message: 'Validation failed',
          errors: [{ field, messages: [message] }],
        });
        expect(hotels.exists).not.toHaveBeenCalled();
      },
    );

    it('accepts a check-in today (UTC)', async () => {
      const today = todayUtc();
      const tomorrow = DateTime.fromISO(today, { zone: 'utc' })
        .plus({ days: 1 })
        .toISODate() as string;
      const { service } = setup();

      await expect(
        service.findAvailable(HOTEL_ID, pageQuery(today, tomorrow)),
      ).resolves.toMatchObject({ items: [] });
    });
  });

  describe('listAvailable: which rooms are free (the rule of hotel-search.ts)', () => {
    it('reads only active rooms of this hotel bookable on the first night, by room number with digits as numbers', async () => {
      const { service, rooms, roomQuery } = setup();

      await service.listAvailable(HOTEL_OID, STAY, NOW);

      expect(rooms.find).toHaveBeenCalledWith({
        hotelId: HOTEL_OID,
        active: true,
        availability: {
          $elemMatch: { from: { $lte: STAY.from }, to: { $gt: STAY.from } },
        },
      });
      expect(roomQuery.collation).toHaveBeenCalledWith({
        locale: 'en',
        numericOrdering: true,
      });
      expect(roomQuery.sort).toHaveBeenCalledWith({ number: 1, _id: 1 });
    });

    it("reads the nights of the stay of this hotel's rooms only, check-out day excluded", async () => {
      const listed = [storedRoom('1'), storedRoom('2')];
      const { service, roomNights, nightQuery } = setup({ rooms: listed });

      await service.listAvailable(HOTEL_OID, STAY, NOW);

      expect(roomNights.find).toHaveBeenCalledWith({
        roomId: { $in: [listed[0]._id, listed[1]._id] },
        date: { $gte: STAY.from, $lt: STAY.to },
      });
      expect(nightQuery.select).toHaveBeenCalledWith(
        'roomId date state holdExpiresAt',
      );
    });

    it('lists a room whose availability covers every night', async () => {
      expect(await freeNumbers([storedRoom('1')])).toEqual(['1']);
    });

    it('lists a room whose ranges only touch inside the stay', async () => {
      const touching = storedRoom('1', {
        availability: [
          { from: '2099-03-01', to: '2099-03-11' },
          { from: '2099-03-11', to: '2099-04-01' },
        ],
      });
      expect(await freeNumbers([touching])).toEqual(['1']);
    });

    it.each([
      ['the first night', [{ from: '2099-03-11', to: '2099-04-01' }]],
      [
        'a night in the middle',
        [
          { from: '2099-03-01', to: '2099-03-11' },
          { from: '2099-03-12', to: '2099-04-01' },
        ],
      ],
      ['the last night', [{ from: '2099-03-01', to: '2099-03-12' }]],
      [
        'every night (free only after the stay)',
        [{ from: '2099-03-13', to: '2099-04-01' }],
      ],
    ])(
      'leaves out a room whose availability misses %s',
      async (_label, availability) => {
        expect(await freeNumbers([storedRoom('1', { availability })])).toEqual(
          [],
        );
      },
    );

    it('needs the availability to cover the stay exactly up to the night before check-out', async () => {
      const exact = storedRoom('1', {
        availability: [{ from: STAY.from, to: STAY.to }],
      });
      expect(await freeNumbers([exact])).toEqual(['1']);
    });

    it.each([
      ['booked', RoomNightState.Booked, undefined],
      ['blocked (HTL-06)', RoomNightState.Blocked, undefined],
      [
        'held by a hold that has not expired (HTL-18)',
        RoomNightState.Held,
        new Date(NOW.getTime() + 1),
      ],
    ])(
      'leaves out a room with a night %s',
      async (_label, state, holdExpiresAt) => {
        const free = storedRoom('1');
        const taken = storedRoom('2');
        expect(
          await freeNumbers(
            [free, taken],
            [night(taken, '2099-03-12', state, holdExpiresAt)],
          ),
        ).toEqual(['1']);
      },
    );

    it('lists a room whose hold has expired', async () => {
      const room = storedRoom('1');
      const expired = new Date(NOW.getTime() - 60_000);
      expect(
        await freeNumbers(
          [room],
          [night(room, '2099-03-10', RoomNightState.Held, expired)],
        ),
      ).toEqual(['1']);
    });

    it('lists a room whose hold expires exactly now (`>`, as in takesTheNight)', async () => {
      const room = storedRoom('1');
      expect(
        await freeNumbers(
          [room],
          [night(room, '2099-03-10', RoomNightState.Held, NOW)],
        ),
      ).toEqual(['1']);
    });

    it('ignores a taken check-out day: it is not a night of the stay', async () => {
      // `isFreeForStay` counts every night it is given, so the check-out day
      // is left out by the query itself (`$lt` checkOut). The e2e test books
      // the check-out day of a real room and shows that it is still listed.
      const { service, roomNights } = setup({ rooms: [storedRoom('1')] });

      const list = await service.listAvailable(HOTEL_OID, STAY, NOW);

      expect(list.map((room) => room.number)).toEqual(['1']);
      expect(roomNights.find).toHaveBeenCalledWith(
        expect.objectContaining({
          date: { $gte: '2099-03-10', $lt: '2099-03-13' },
        }),
      );
    });

    it('keeps the order of the database (room number, then id)', async () => {
      expect(
        await freeNumbers([
          storedRoom('2'),
          storedRoom('10'),
          storedRoom('A1'),
        ]),
      ).toEqual(['2', '10', 'A1']);
    });

    it('does not read the nights when no room can be free', async () => {
      const { service, roomNights } = setup({ rooms: [] });

      await expect(
        service.listAvailable(HOTEL_OID, STAY, NOW),
      ).resolves.toEqual([]);
      expect(roomNights.find).not.toHaveBeenCalled();
    });

    it('prices a one-night stay at the price of one night', async () => {
      const { service } = setup({
        rooms: [storedRoom('1', { pricePerNight: 9900 })],
      });

      const [room] = await service.listAvailable(
        HOTEL_OID,
        { from: '2099-03-10', to: '2099-03-11' },
        NOW,
      );

      expect(room).toMatchObject({ nights: 1, totalPrice: 9900 });
    });

    it('gives the hotel page the same list as the route, without pages', async () => {
      const rooms = ['1', '2', '3'].map((n) => storedRoom(n));
      const nights = [night(rooms[1], '2099-03-10', RoomNightState.Blocked)];

      const page = await setup({ rooms, nights }).service.findAvailable(
        HOTEL_ID,
        pageQuery(STAY.from, STAY.to, 1, 50),
        NOW,
      );
      const list = await setup({ rooms, nights }).service.listAvailable(
        HOTEL_OID,
        STAY,
        NOW,
      );

      expect(list).toEqual(page.items);
      expect(list.map((room) => room.number)).toEqual(['1', '3']);
    });
  });
});
