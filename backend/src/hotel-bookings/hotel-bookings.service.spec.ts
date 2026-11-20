import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import type { HotelBookingConfirmationService } from './hotel-booking-confirmation.service';
import {
  BOOKING_NOT_FOUND_MESSAGE,
  HotelBookingsService,
} from './hotel-bookings.service';

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
    ...fields,
  }) as CreateHotelBookingDto;

const setup = (
  options: {
    hotel?: object;
    holdError?: Error;
    createError?: Error;
  } = {},
) => {
  const bookings = {
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
  const service = new HotelBookingsService(
    bookings as never,
    roomHolds as unknown as HotelRoomHoldsService,
    {} as HotelBookingConfirmationService,
  );
  return { service, bookings, roomHolds };
};

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

describe('HotelBookingsService owner lookup and policy acceptance (PAY-02)', () => {
  const BOOKING_ID = '6740f1c2a4b5c6d7e8f90789';
  const OWNER_ID = '6740f1c2a4b5c6d7e8f90123';
  const AT = new Date('2026-11-19T10:02:00.000Z');

  /** A fake model whose `findOne` and `findOneAndUpdate` resolve to `found`. */
  const ownedSetup = (found: unknown) => {
    const query = () => ({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(found),
    });
    const bookings = {
      findOne: jest.fn(query),
      findOneAndUpdate: jest.fn(query),
    };
    const service = new HotelBookingsService(
      bookings as never,
      {} as HotelRoomHoldsService,
      {} as HotelBookingConfirmationService,
    );
    return { service, bookings };
  };

  it("finds the user's own reservation by id and owner", async () => {
    const stored = { _id: BOOKING_ID, status: 'pending_payment' };
    const { service, bookings } = ownedSetup(stored);

    await expect(
      service.findOwnedEntityOrThrow(BOOKING_ID, OWNER_ID),
    ).resolves.toBe(stored);
    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID,
      userId: new Types.ObjectId(OWNER_ID),
    });
  });

  it("answers 404 for a missing reservation or another user's, with the same message", async () => {
    const { service } = ownedSetup(null);

    const error: unknown = await service
      .findOwnedEntityOrThrow(BOOKING_ID, OWNER_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe('Booking not found');
    expect(BOOKING_NOT_FOUND_MESSAGE).toBe('Booking not found');
  });

  it('accepts with one conditional update: owner, pending, live hold, not accepted before', async () => {
    const accepted = { _id: BOOKING_ID, policyAcceptedAt: AT };
    const { service, bookings } = ownedSetup(accepted);

    await expect(
      service.acceptPolicies(BOOKING_ID, OWNER_ID, AT),
    ).resolves.toBe(accepted);
    expect(bookings.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(bookings.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: BOOKING_ID,
        userId: new Types.ObjectId(OWNER_ID),
        status: 'pending_payment',
        holdExpiresAt: { $gt: AT },
        policyAcceptedAt: { $exists: false },
      },
      { $set: { policyAcceptedAt: AT } },
      { returnDocument: 'after' },
    );
  });

  it('returns null when nothing matched', async () => {
    const { service } = ownedSetup(null);

    await expect(
      service.acceptPolicies(BOOKING_ID, OWNER_ID, AT),
    ).resolves.toBeNull();
  });
});

describe('HotelBookingsService.findTravellerIdsOfHotel (ACC-15)', () => {
  const TRAVELLER_A = new Types.ObjectId();
  const TRAVELLER_B = new Types.ObjectId();

  /** A fake model whose `distinct` resolves to the given user ids. */
  const lookupSetup = (userIds: Types.ObjectId[] = []) => {
    const bookings = {
      distinct: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(userIds),
      })),
    };
    const service = new HotelBookingsService(
      bookings as never,
      {} as HotelRoomHoldsService,
      {} as HotelBookingConfirmationService,
    );
    return { service, bookings };
  };

  it('reads the users with a confirmed reservation of the hotel whose check-out is today or later', async () => {
    const { service, bookings } = lookupSetup([TRAVELLER_A, TRAVELLER_B]);

    await expect(
      service.findTravellerIdsOfHotel(
        HOTEL_ID,
        new Date('2026-11-19T10:00:00.000Z'),
      ),
    ).resolves.toEqual([TRAVELLER_A, TRAVELLER_B]);

    expect(bookings.distinct).toHaveBeenCalledTimes(1);
    expect(bookings.distinct).toHaveBeenCalledWith('userId', {
      hotelId: HOTEL_ID,
      status: HotelBookingStatus.Confirmed,
      checkOut: { $gte: '2026-11-19' },
    });
  });

  it.each([
    ['2026-11-19T23:59:59.999Z', '2026-11-19'],
    ['2026-11-20T00:00:00.000Z', '2026-11-20'],
  ])('uses the UTC date of now (%s -> %s)', async (now, today) => {
    const { service, bookings } = lookupSetup();

    await service.findTravellerIdsOfHotel(HOTEL_ID, new Date(now));

    expect(bookings.distinct).toHaveBeenCalledWith(
      'userId',
      expect.objectContaining({ checkOut: { $gte: today } }),
    );
  });

  it('returns [] when nobody has such a reservation', async () => {
    const { service } = lookupSetup([]);

    await expect(
      service.findTravellerIdsOfHotel(HOTEL_ID, new Date()),
    ).resolves.toEqual([]);
  });
});
