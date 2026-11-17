import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import type { HotelsService } from '../hotels/hotels.service';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import type { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings-query.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelBookingGroup } from './hotel-booking-groups';
import { HotelBookingsService } from './hotel-bookings.service';

const USER_ID = new Types.ObjectId().toString();
const HOTEL_ID = new Types.ObjectId();

const freeRoom = (number: string, pricePerNight: number) => ({
  _id: new Types.ObjectId(),
  number,
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight,
});

const ROOM_A = freeRoom('101', 12500);
const ROOM_B = freeRoom('102', 10000);

const HOTEL = {
  _id: HOTEL_ID,
  name: 'Nile Hotel',
  policy: {
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
  },
};

const dto = (fields: Partial<CreateHotelBookingDto> = {}) =>
  ({
    hotelId: HOTEL_ID.toString(),
    checkIn: '2026-12-10',
    checkOut: '2026-12-13',
    rooms: [
      { roomId: ROOM_A._id.toString(), adults: 2, childAges: [7] },
      { roomId: ROOM_B._id.toString(), adults: 1, childAges: [] },
    ],
    acceptPolicies: true,
    ...fields,
  }) as CreateHotelBookingDto;

const setup = (
  options: {
    hotel?: object;
    holdError?: Error;
    createError?: Error;
    stored?: object[];
    total?: number;
    found?: object | null;
  } = {},
) => {
  const listChain = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(options.stored ?? []),
  };
  for (const step of ['sort', 'skip', 'limit', 'lean'] as const) {
    listChain[step].mockReturnValue(listChain);
  }
  const bookings = {
    find: jest.fn().mockReturnValue(listChain),
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(options.total ?? 0),
    }),
    findById: jest.fn().mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve(options.found ?? null),
      }),
    }),
    create: jest.fn((fields: Record<string, unknown>) =>
      options.createError
        ? Promise.reject(options.createError)
        : Promise.resolve({
            toObject: () => ({
              ...fields,
              createdAt: new Date('2026-11-17T18:00:00.000Z'),
              updatedAt: new Date('2026-11-17T18:00:00.000Z'),
            }),
          }),
    ),
  };
  const roomHolds = {
    findBookableRooms: jest.fn().mockResolvedValue({
      hotel: options.hotel ?? HOTEL,
      rooms: [ROOM_A, ROOM_B],
    }),
    hold: jest.fn(() =>
      options.holdError
        ? Promise.reject(options.holdError)
        : Promise.resolve(undefined),
    ),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const hotels = {
    findNamesByIds: jest
      .fn()
      .mockResolvedValue(new Map([[HOTEL_ID.toString(), 'Nile Hotel']])),
  };
  const service = new HotelBookingsService(
    bookings as never,
    roomHolds as unknown as HotelRoomHoldsService,
    hotels as unknown as HotelsService,
  );
  return { service, bookings, roomHolds, hotels, listChain };
};

/** A reservation as it is stored, for the read tests (HTL-20). */
const stored = (fields: object = {}) => ({
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(USER_ID),
  hotelId: HOTEL_ID,
  checkIn: '2026-12-10',
  checkOut: '2026-12-13',
  nights: 3,
  status: HotelBookingStatus.Confirmed,
  currency: 'USD',
  total: 37500,
  rooms: [
    {
      roomId: ROOM_A._id,
      roomLabel: '101 (Double)',
      pricePerNight: 12500,
      adults: 2,
      childAges: [],
    },
  ],
  cancellationTiers: [],
  policyAcceptedAt: new Date('2026-11-17T18:00:00.000Z'),
  createdAt: new Date('2026-11-17T18:00:00.000Z'),
  updatedAt: new Date('2026-11-17T18:00:00.000Z'),
  ...fields,
});

const listQuery = (group?: HotelBookingGroup, page = 1, limit = 10) =>
  ({
    group,
    page,
    limit,
    skip: (page - 1) * limit,
  }) as ListHotelBookingsQueryDto;

describe('HotelBookingsService (HTL-16, HTL-18)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-17T18:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks the hotel for the rooms with the guests of each', async () => {
    const { service, roomHolds } = setup();

    await service.create(USER_ID, dto());

    expect(roomHolds.findBookableRooms).toHaveBeenCalledWith(
      HOTEL_ID.toString(),
      [
        { roomId: ROOM_A._id.toString(), guests: 3 },
        { roomId: ROOM_B._id.toString(), guests: 1 },
      ],
      { from: '2026-12-10', to: '2026-12-13' },
    );
  });

  it('holds every room for 10 minutes under the new reservation id', async () => {
    const { service, roomHolds, bookings } = setup();

    await service.create(USER_ID, dto());

    const holdExpiresAt = new Date('2026-11-17T18:10:00.000Z');
    expect(roomHolds.hold).toHaveBeenCalledWith(
      HOTEL_ID,
      [ROOM_A._id, ROOM_B._id],
      { from: '2026-12-10', to: '2026-12-13' },
      expect.any(Types.ObjectId),
      holdExpiresAt,
    );
    const heldFor = (roomHolds.hold.mock.calls[0] as unknown[])[3];
    const saved = bookings.create.mock.calls[0][0];
    expect(saved._id).toBe(heldFor);
    expect(saved.holdExpiresAt).toEqual(holdExpiresAt);
  });

  it('saves a pending reservation with the prices, times and tiers of now', async () => {
    const { service } = setup();

    const response = await service.create(USER_ID, dto());

    expect(response).toEqual(
      expect.objectContaining({
        hotelId: HOTEL_ID.toString(),
        checkIn: '2026-12-10',
        checkOut: '2026-12-13',
        nights: 3,
        status: HotelBookingStatus.PendingPayment,
        holdExpiresAt: '2026-11-17T18:10:00.000Z',
        currency: 'USD',
        // 3 nights x (12500 + 10000)
        total: 67500,
        reference: null,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        policyAcceptedAt: '2026-11-17T18:00:00.000Z',
        hotelName: 'Nile Hotel',
      }),
    );
    expect(response.rooms).toEqual([
      {
        roomId: ROOM_A._id.toString(),
        roomLabel: '101 (Double)',
        pricePerNight: 12500,
        subtotal: 37500,
        adults: 2,
        childAges: [7],
      },
      {
        roomId: ROOM_B._id.toString(),
        roomLabel: '102 (Double)',
        pricePerNight: 10000,
        subtotal: 30000,
        adults: 1,
        childAges: [],
      },
    ]);
  });

  it('stores the user as the owner', async () => {
    const { service, bookings } = setup();

    await service.create(USER_ID, dto());

    expect(bookings.create.mock.calls[0][0].userId).toEqual(
      new Types.ObjectId(USER_ID),
    );
  });

  it('copies no times or tiers from a hotel without a policy', async () => {
    const { service } = setup({ hotel: { _id: HOTEL_ID, name: 'Plain' } });

    const response = await service.create(USER_ID, dto());

    expect(response.checkInTime).toBeNull();
    expect(response.checkOutTime).toBeNull();
    expect(response.cancellationTiers).toEqual([]);
  });

  it('treats missing child ages as no children', async () => {
    const { service, roomHolds } = setup();

    await service.create(
      USER_ID,
      dto({
        rooms: [
          {
            roomId: ROOM_A._id.toString(),
            adults: 1,
            childAges: undefined as unknown as number[],
          },
          { roomId: ROOM_B._id.toString(), adults: 1, childAges: [] },
        ],
      }),
    );

    expect(roomHolds.findBookableRooms.mock.calls[0][1][0]).toEqual({
      roomId: ROOM_A._id.toString(),
      guests: 1,
    });
  });

  it('saves nothing when the rooms cannot be held', async () => {
    const conflict = new ConflictException('taken');
    const { service, bookings, roomHolds } = setup({ holdError: conflict });

    await expect(service.create(USER_ID, dto())).rejects.toBe(conflict);
    expect(bookings.create).not.toHaveBeenCalled();
    expect(roomHolds.release).not.toHaveBeenCalled();
  });

  it('releases the rooms when the reservation cannot be saved', async () => {
    const failure = new Error('database down');
    const { service, roomHolds } = setup({ createError: failure });

    await expect(service.create(USER_ID, dto())).rejects.toBe(failure);
    const heldFor = (roomHolds.hold.mock.calls[0] as unknown[])[3];
    expect(roomHolds.release).toHaveBeenCalledWith(heldFor);
  });
});

describe('HotelBookingsService reads (HTL-20)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-17T18:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('findMine', () => {
    it("reads only the user's own reservations of the group, one page", async () => {
      const booking = stored();
      const { service, bookings, listChain, hotels } = setup({
        stored: [booking],
        total: 11,
      });

      const page = await service.findMine(
        USER_ID,
        listQuery(HotelBookingGroup.Cancelled, 2, 5),
      );

      const filter = {
        status: HotelBookingStatus.Cancelled,
        userId: new Types.ObjectId(USER_ID),
      };
      expect(bookings.find).toHaveBeenCalledWith(filter);
      expect(bookings.countDocuments).toHaveBeenCalledWith(filter);
      expect(listChain.sort).toHaveBeenCalledWith({ checkIn: -1, _id: -1 });
      expect(listChain.skip).toHaveBeenCalledWith(5);
      expect(listChain.limit).toHaveBeenCalledWith(5);
      expect(hotels.findNamesByIds).toHaveBeenCalledWith([HOTEL_ID]);
      expect(page.meta).toEqual({
        page: 2,
        limit: 5,
        total: 11,
        totalPages: 3,
      });
      expect(page.items).toEqual([
        expect.objectContaining({
          id: booking._id.toString(),
          hotelName: 'Nile Hotel',
          status: 'confirmed',
        }),
      ]);
    });

    it('uses the date and the moment of now for the upcoming group', async () => {
      const { service, bookings } = setup();

      await service.findMine(USER_ID, listQuery(HotelBookingGroup.Upcoming));

      expect(bookings.find).toHaveBeenCalledWith({
        $or: [
          {
            status: HotelBookingStatus.Confirmed,
            checkOut: { $gte: '2026-11-17' },
          },
          {
            status: HotelBookingStatus.PendingPayment,
            holdExpiresAt: { $gt: new Date('2026-11-17T18:00:00.000Z') },
          },
        ],
        userId: new Types.ObjectId(USER_ID),
      });
    });

    it('asks for each hotel name once and shows null for a missing hotel', async () => {
      const otherHotel = new Types.ObjectId();
      const { service, hotels } = setup({
        stored: [stored(), stored(), stored({ hotelId: otherHotel })],
        total: 3,
      });

      const page = await service.findMine(USER_ID, listQuery());

      expect(hotels.findNamesByIds).toHaveBeenCalledWith([
        HOTEL_ID,
        otherHotel,
      ]);
      expect(page.items.map((item) => item.hotelName)).toEqual([
        'Nile Hotel',
        'Nile Hotel',
        null,
      ]);
    });
  });

  describe('findMineById', () => {
    it('returns the full reservation to its owner', async () => {
      const booking = stored();
      const { service, bookings } = setup({ found: booking });

      const response = await service.findMineById(
        booking._id.toString(),
        USER_ID,
      );

      expect(bookings.findById).toHaveBeenCalledWith(booking._id.toString());
      expect(response).toEqual(
        expect.objectContaining({
          id: booking._id.toString(),
          hotelName: 'Nile Hotel',
          total: 37500,
        }),
      );
    });

    it('answers 404 for a reservation that does not exist', async () => {
      const { service } = setup({ found: null });

      await expect(
        service.findMineById(new Types.ObjectId().toString(), USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 403 for the reservation of someone else', async () => {
      const { service, hotels } = setup({
        found: stored({ userId: new Types.ObjectId() }),
      });

      await expect(
        service.findMineById(new Types.ObjectId().toString(), USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(hotels.findNamesByIds).not.toHaveBeenCalled();
    });
  });
});
