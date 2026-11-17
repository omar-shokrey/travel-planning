import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelsService } from '../hotels/hotels.service';
import type { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { HotelReservationsService } from './hotel-reservations.service';

const HOTEL_ID = new Types.ObjectId();
const MODERATOR_ID = new Types.ObjectId().toString();
const GUEST_A = new Types.ObjectId();
const GUEST_B = new Types.ObjectId();

const stored = (userId: Types.ObjectId, fields: object = {}) => ({
  _id: new Types.ObjectId(),
  userId,
  hotelId: HOTEL_ID,
  checkIn: '2026-12-10',
  checkOut: '2026-12-12',
  nights: 2,
  status: HotelBookingStatus.Confirmed,
  currency: 'USD',
  total: 20000,
  rooms: [
    {
      roomId: new Types.ObjectId(),
      roomLabel: '101 (Double)',
      pricePerNight: 10000,
      adults: 1,
      childAges: [],
    },
  ],
  cancellationTiers: [],
  policyAcceptedAt: new Date('2026-11-17T18:00:00.000Z'),
  createdAt: new Date('2026-11-17T18:00:00.000Z'),
  updatedAt: new Date('2026-11-17T18:00:00.000Z'),
  ...fields,
});

const query = (status?: HotelBookingStatus, page = 1, limit = 10) =>
  ({
    status,
    page,
    limit,
    skip: (page - 1) * limit,
  }) as HotelReservationsQueryDto;

const setup = (
  options: { stored?: object[]; total?: number; denied?: boolean } = {},
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
  };
  const userChain = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue([{ _id: GUEST_A, name: 'Sara Ahmed' }]),
  };
  userChain.select.mockReturnValue(userChain);
  userChain.lean.mockReturnValue(userChain);
  const users = { find: jest.fn().mockReturnValue(userChain) };
  const hotels = {
    findManagedEntityOrThrow: jest.fn(() =>
      options.denied
        ? Promise.reject(new ForbiddenException('not yours'))
        : Promise.resolve({ _id: HOTEL_ID }),
    ),
  };
  const service = new HotelReservationsService(
    bookings as never,
    users as never,
    hotels as unknown as HotelsService,
  );
  return { service, bookings, users, hotels, listChain, userChain };
};

describe('HotelReservationsService (HTL-22)', () => {
  it('checks that the moderator manages the hotel first', async () => {
    const { service, hotels, bookings } = setup({ denied: true });

    await expect(
      service.findForHotel(HOTEL_ID.toString(), query(), MODERATOR_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(hotels.findManagedEntityOrThrow).toHaveBeenCalledWith(
      HOTEL_ID.toString(),
      MODERATOR_ID,
    );
    expect(bookings.find).not.toHaveBeenCalled();
  });

  it('reads one page of the hotel, latest check-in first, without expired holds', async () => {
    const { service, bookings, listChain } = setup({ total: 23 });

    const page = await service.findForHotel(
      HOTEL_ID.toString(),
      query(undefined, 3, 10),
      MODERATOR_ID,
    );

    const filter = {
      hotelId: HOTEL_ID,
      status: { $ne: HotelBookingStatus.Expired },
    };
    expect(bookings.find).toHaveBeenCalledWith(filter);
    expect(bookings.countDocuments).toHaveBeenCalledWith(filter);
    expect(listChain.sort).toHaveBeenCalledWith({ checkIn: -1, _id: -1 });
    expect(listChain.skip).toHaveBeenCalledWith(20);
    expect(listChain.limit).toHaveBeenCalledWith(10);
    expect(page.meta).toEqual({ page: 3, limit: 10, total: 23, totalPages: 3 });
  });

  it('keeps only the status asked for, expired included', async () => {
    const { service, bookings } = setup();

    await service.findForHotel(
      HOTEL_ID.toString(),
      query(HotelBookingStatus.Expired),
      MODERATOR_ID,
    );

    expect(bookings.find).toHaveBeenCalledWith({
      hotelId: HOTEL_ID,
      status: HotelBookingStatus.Expired,
    });
  });

  it('reads each guest name once and shows null for a missing account', async () => {
    const { service, users, userChain } = setup({
      stored: [stored(GUEST_A), stored(GUEST_A), stored(GUEST_B)],
      total: 3,
    });

    const page = await service.findForHotel(
      HOTEL_ID.toString(),
      query(),
      MODERATOR_ID,
    );

    expect(users.find).toHaveBeenCalledWith({
      _id: { $in: [GUEST_A, GUEST_B] },
    });
    expect(userChain.select).toHaveBeenCalledWith('name');
    expect(page.items.map((item) => item.guestName)).toEqual([
      'Sara Ahmed',
      'Sara Ahmed',
      null,
    ]);
  });

  it('does not read users for an empty page', async () => {
    const { service, users } = setup();

    const page = await service.findForHotel(
      HOTEL_ID.toString(),
      query(),
      MODERATOR_ID,
    );

    expect(page.items).toEqual([]);
    expect(users.find).not.toHaveBeenCalled();
  });
});
