import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelRoomHoldsService } from '../hotels/hotel-room-holds.service';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
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
        policyAcceptedAt: '2026-11-17T18:00:00.000Z',
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
