import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { RoomStatusQueryDto } from './dto/room-status-query.dto';
import { HotelRoomStatusService } from './hotel-room-status.service';
import type { HotelsService } from './hotels.service';
import { RoomNightState } from './models/room-night-state.enum';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const ROOM_ID = '6740f1c2a4b5c6d7e8f90124';
const OTHER_ROOM_ID = '6740f1c2a4b5c6d7e8f90125';
const USER_ID = '6740f1c2a4b5c6d7e8f90126';
const BOOKING_ID = '6740f1c2a4b5c6d7e8f90127';

const range = (from: string, to: string) => ({ from, to });

/** A Mongoose query that resolves to `value`, with the chain the service uses. */
const query = <T>(value: T) => {
  const chain = {
    select: jest.fn(),
    collation: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const step of [
    'select',
    'collation',
    'sort',
    'skip',
    'limit',
    'lean',
  ] as const) {
    chain[step].mockReturnValue(chain);
  }
  return chain;
};

const roomQuery = (from: string, to: string, page = 1, limit = 10) =>
  ({ from, to, page, limit, skip: (page - 1) * limit }) as RoomStatusQueryDto;

const setup = (
  options: {
    rooms?: object[];
    total?: number;
    nights?: object[];
    hotelError?: Error;
  } = {},
) => {
  const storedRooms = options.rooms ?? [
    {
      _id: new Types.ObjectId(ROOM_ID),
      number: '101',
      type: 'Double',
      active: true,
      availability: [range('2026-12-01', '2026-12-31')],
    },
    {
      _id: new Types.ObjectId(OTHER_ROOM_ID),
      number: '102',
      type: 'Single',
      active: false,
      availability: [],
    },
  ];
  const roomsFind = query(storedRooms);
  const nightsFind = query(options.nights ?? []);
  const rooms = {
    find: jest.fn().mockReturnValue(roomsFind),
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(options.total ?? storedRooms.length),
    }),
  };
  const roomNights = { find: jest.fn().mockReturnValue(nightsFind) };
  const hotelsService = {
    findManagedEntityOrThrow: options.hotelError
      ? jest.fn().mockRejectedValue(options.hotelError)
      : jest.fn().mockResolvedValue({ _id: new Types.ObjectId(HOTEL_ID) }),
  };
  const service = new HotelRoomStatusService(
    rooms as never,
    roomNights as never,
    hotelsService as unknown as HotelsService,
  );
  return { service, rooms, roomsFind, roomNights, hotelsService };
};

describe('HotelRoomStatusService (HTL-08)', () => {
  it('returns every room of the page with the status of each night', async () => {
    const { service, roomNights, hotelsService } = setup({
      nights: [
        {
          roomId: new Types.ObjectId(ROOM_ID),
          date: '2026-12-02',
          state: RoomNightState.Booked,
          bookingId: new Types.ObjectId(BOOKING_ID),
        },
        {
          roomId: new Types.ObjectId(ROOM_ID),
          date: '2026-12-03',
          state: RoomNightState.Blocked,
        },
      ],
    });

    const result = await service.findStatus(
      HOTEL_ID,
      roomQuery('2026-12-01', '2026-12-05'),
      USER_ID,
    );

    expect(hotelsService.findManagedEntityOrThrow).toHaveBeenCalledWith(
      HOTEL_ID,
      USER_ID,
    );
    expect(roomNights.find).toHaveBeenCalledWith({
      roomId: {
        $in: [new Types.ObjectId(ROOM_ID), new Types.ObjectId(OTHER_ROOM_ID)],
      },
      date: { $gte: '2026-12-01', $lt: '2026-12-05' },
    });
    expect(result).toEqual({
      items: [
        {
          id: ROOM_ID,
          number: '101',
          type: 'Double',
          active: true,
          segments: [
            { from: '2026-12-01', to: '2026-12-02', status: 'available' },
            {
              from: '2026-12-02',
              to: '2026-12-03',
              status: 'booked',
              bookingId: BOOKING_ID,
              pendingPayment: false,
            },
            { from: '2026-12-03', to: '2026-12-04', status: 'blocked' },
            { from: '2026-12-04', to: '2026-12-05', status: 'available' },
          ],
        },
        {
          id: OTHER_ROOM_ID,
          number: '102',
          type: 'Single',
          active: false,
          segments: [
            { from: '2026-12-01', to: '2026-12-05', status: 'unavailable' },
          ],
        },
      ],
      meta: { page: 1, limit: 10, total: 2, totalPages: 1 },
    });
  });

  it('sorts the room numbers with their digits compared as numbers', async () => {
    const { service, roomsFind } = setup();

    await service.findStatus(
      HOTEL_ID,
      roomQuery('2026-12-01', '2026-12-02'),
      USER_ID,
    );

    expect(roomsFind.collation).toHaveBeenCalledWith({
      locale: 'en',
      numericOrdering: true,
    });
    expect(roomsFind.sort).toHaveBeenCalledWith({ number: 1, _id: 1 });
  });

  it('pages through the rooms of the hotel only, sorted by number', async () => {
    const { service, rooms, roomsFind } = setup({ total: 12 });

    const result = await service.findStatus(
      HOTEL_ID,
      roomQuery('2026-12-01', '2026-12-02', 2, 5),
      USER_ID,
    );

    expect(rooms.find).toHaveBeenCalledWith({
      hotelId: new Types.ObjectId(HOTEL_ID),
    });
    expect(roomsFind.sort).toHaveBeenCalledWith({ number: 1, _id: 1 });
    expect(roomsFind.skip).toHaveBeenCalledWith(5);
    expect(roomsFind.limit).toHaveBeenCalledWith(5);
    expect(result.meta).toEqual({
      page: 2,
      limit: 5,
      total: 12,
      totalPages: 3,
    });
  });

  it('does not read any night when the page has no room', async () => {
    const { service, roomNights } = setup({ rooms: [], total: 0 });

    const result = await service.findStatus(
      HOTEL_ID,
      roomQuery('2026-12-01', '2026-12-02'),
      USER_ID,
    );

    expect(roomNights.find).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });

  it('refuses a range of more than 366 nights before reading anything', async () => {
    const { service, hotelsService } = setup();

    await expect(
      service.findStatus(
        HOTEL_ID,
        roomQuery('2026-01-01', '2027-01-03'),
        USER_ID,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(hotelsService.findManagedEntityOrThrow).not.toHaveBeenCalled();
  });

  it('accepts a range of exactly 366 nights', async () => {
    const { service } = setup({ rooms: [], total: 0 });

    await expect(
      service.findStatus(
        HOTEL_ID,
        roomQuery('2026-01-01', '2027-01-02'),
        USER_ID,
      ),
    ).resolves.toBeDefined();
  });

  it('passes on the refusal for a hotel that is not the moderator', async () => {
    const { service, rooms } = setup({
      hotelError: new ForbiddenException(),
    });

    await expect(
      service.findStatus(
        HOTEL_ID,
        roomQuery('2026-12-01', '2026-12-02'),
        USER_ID,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(rooms.find).not.toHaveBeenCalled();
  });
});
