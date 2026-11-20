import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { HotelsService } from '../hotels/hotels.service';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundStatus } from '../payments/refunds/enums/refund-status.enum';
import type { RefundsService } from '../payments/refunds/refunds.service';
import type { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { ReservationGroup } from './enums/reservation-group.enum';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';
import { HotelReservationsService } from './hotel-reservations.service';

const TODAY = '2027-06-15';
const USER_ID = new Types.ObjectId();
const HOTEL_A = new Types.ObjectId();
const HOTEL_B = new Types.ObjectId();

const reservation = (
  hotelId: Types.ObjectId,
  status: HotelBookingStatus,
  checkOut: string,
) => ({
  _id: new Types.ObjectId(),
  reference: 'HB-7KQ2MX',
  userId: USER_ID,
  hotelId,
  checkIn: '2027-06-10',
  checkOut,
  nights: 3,
  status,
  currency: 'USD',
  total: 37500,
  rooms: [
    {
      roomId: new Types.ObjectId(),
      roomLabel: '101 (Double)',
      pricePerNight: 12500,
      adults: 2,
      childAges: [],
    },
  ],
  cancellationTiers: [],
  createdAt: new Date('2027-06-01T10:00:00.000Z'),
  updatedAt: new Date('2027-06-01T10:00:00.000Z'),
});

const query = (fields: Partial<HotelReservationsQueryDto> = {}) =>
  ({ page: 1, limit: 10, skip: 0, ...fields }) as HotelReservationsQueryDto;

function setup(
  page: unknown[] = [],
  total = page.length,
  found: unknown = null,
) {
  const find = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(page),
  };
  find.sort.mockReturnValue(find);
  find.skip.mockReturnValue(find);
  find.limit.mockReturnValue(find);
  find.lean.mockReturnValue(find);
  const findOne = {
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(found),
  };
  findOne.lean.mockReturnValue(findOne);
  const bookings = {
    find: jest.fn(() => find),
    findOne: jest.fn(() => findOne),
    countDocuments: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(total),
    })),
  };
  const hotels = {
    findNamesByIds: jest.fn().mockResolvedValue(
      new Map([
        [HOTEL_A.toString(), 'Nile Hotel'],
        [HOTEL_B.toString(), 'Sea Hotel'],
      ]),
    ),
  };
  const refunds = { findSummaryByBooking: jest.fn().mockResolvedValue(null) };
  const service = new HotelReservationsService(
    bookings as never,
    hotels as unknown as HotelsService,
    refunds as unknown as RefundsService,
  );
  return { service, bookings, find, hotels, refunds };
}

describe('HotelReservationsService.list (HTL-20)', () => {
  it('filters by the user and the group, sorts, pages, and counts with the same filter', async () => {
    const { service, bookings, find } = setup();

    await service.list(
      USER_ID.toString(),
      query({ group: ReservationGroup.Upcoming, page: 2, limit: 5, skip: 5 }),
      TODAY,
    );

    const expected = {
      userId: USER_ID,
      status: HotelBookingStatus.Confirmed,
      checkOut: { $gte: TODAY },
    };
    expect(bookings.find).toHaveBeenCalledWith(expected);
    expect(bookings.countDocuments).toHaveBeenCalledWith(expected);
    expect(find.sort).toHaveBeenCalledWith({ checkIn: 1, _id: 1 });
    expect(find.skip).toHaveBeenCalledWith(5);
    expect(find.limit).toHaveBeenCalledWith(5);
  });

  it('lists only the three groups when no group is asked', async () => {
    const { service, bookings } = setup();

    await service.list(USER_ID.toString(), query(), TODAY);

    expect(bookings.find).toHaveBeenCalledWith({
      userId: USER_ID,
      status: {
        $in: [
          HotelBookingStatus.Confirmed,
          HotelBookingStatus.Completed,
          HotelBookingStatus.Cancelled,
        ],
      },
    });
  });

  it('reads the hotel names of the page in one call and labels each reservation with its group', async () => {
    const page = [
      reservation(HOTEL_A, HotelBookingStatus.Confirmed, '2027-06-20'),
      reservation(HOTEL_B, HotelBookingStatus.Confirmed, '2027-06-12'),
      reservation(HOTEL_A, HotelBookingStatus.Cancelled, '2027-06-20'),
    ];
    const { service, hotels } = setup(page, 23);

    const result = await service.list(USER_ID.toString(), query(), TODAY);

    expect(hotels.findNamesByIds).toHaveBeenCalledTimes(1);
    expect(hotels.findNamesByIds).toHaveBeenCalledWith([
      HOTEL_A,
      HOTEL_B,
      HOTEL_A,
    ]);
    expect(result.items.map((item) => [item.hotel.name, item.group])).toEqual([
      ['Nile Hotel', ReservationGroup.Upcoming],
      ['Sea Hotel', ReservationGroup.Past],
      ['Nile Hotel', ReservationGroup.Cancelled],
    ]);
    expect(result.meta).toEqual({
      page: 1,
      limit: 10,
      total: 23,
      totalPages: 3,
    });
  });

  it('fails loudly instead of mislabelling a listed reservation that is in no group', async () => {
    const { service } = setup([
      reservation(HOTEL_A, HotelBookingStatus.PendingPayment, '2027-06-20'),
    ]);

    await expect(
      service.list(USER_ID.toString(), query(), TODAY),
    ).rejects.toThrow('is listed but in no group');
  });

  it('answers an empty page when the user has no reservation', async () => {
    const { service } = setup([], 0);

    await expect(
      service.list(USER_ID.toString(), query(), TODAY),
    ).resolves.toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });
});

describe('HotelReservationsService.findOne (HTL-20)', () => {
  it("looks up the user's own reservation and adds the hotel name and the refund", async () => {
    const stored = reservation(
      HOTEL_A,
      HotelBookingStatus.Cancelled,
      '2027-06-20',
    );
    const { service, bookings, refunds } = setup([], 0, stored);
    const summary = {
      id: 'refund-1',
      status: RefundStatus.Refunded,
      amount: 37500,
      currency: 'USD',
      refundPercent: 100,
    };
    refunds.findSummaryByBooking.mockResolvedValue(summary);

    const details = await service.findOne(
      stored._id.toString(),
      USER_ID.toString(),
      TODAY,
    );

    expect(bookings.findOne).toHaveBeenCalledWith({
      _id: stored._id.toString(),
      userId: USER_ID,
    });
    expect(refunds.findSummaryByBooking).toHaveBeenCalledWith(
      BookingType.Hotel,
      stored._id.toString(),
    );
    expect(details).toMatchObject({
      hotel: { name: 'Nile Hotel' },
      group: ReservationGroup.Cancelled,
      refund: summary,
    });
  });

  it("answers 404 for a missing reservation or someone else's, and reads nothing else", async () => {
    const { service, hotels, refunds } = setup([], 0, null);

    await expect(
      service.findOne(
        new Types.ObjectId().toString(),
        USER_ID.toString(),
        TODAY,
      ),
    ).rejects.toThrow(new NotFoundException(BOOKING_NOT_FOUND_MESSAGE));
    expect(hotels.findNamesByIds).not.toHaveBeenCalled();
    expect(refunds.findSummaryByBooking).not.toHaveBeenCalled();
  });
});
