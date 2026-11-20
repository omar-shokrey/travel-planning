import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { UsersService } from '../users/users.service';
import type { ModeratorReservationsQueryDto } from './dto/moderator-reservations-query.dto';
import {
  type HotelBookingLookup,
  ModeratorReservationStatus,
} from './hotel-booking-lookup.service';
import { HotelModeratorReservationsService } from './hotel-moderator-reservations.service';
import type { HotelsService } from './hotels.service';

const HOTEL_ID = new Types.ObjectId();
const GUEST_A = new Types.ObjectId();
const GUEST_B = new Types.ObjectId();

const reservation = (userId: Types.ObjectId) => ({
  _id: new Types.ObjectId(),
  reference: 'HB-7KQ2MX',
  userId,
  checkIn: '2027-06-15',
  checkOut: '2027-06-18',
  nights: 3,
  status: ModeratorReservationStatus.Confirmed,
  rooms: [{ roomLabel: '101 (Double)', adults: 2, childAges: [] }],
  createdAt: new Date('2027-06-01T10:00:00.000Z'),
});

const query = (fields: Partial<ModeratorReservationsQueryDto> = {}) =>
  ({ page: 1, limit: 10, skip: 0, ...fields }) as ModeratorReservationsQueryDto;

function setup(items: unknown[] = [], total = items.length) {
  const hotels = {
    findManagedEntityOrThrow: jest.fn().mockResolvedValue({ _id: HOTEL_ID }),
  };
  const lookup = {
    listForHotel: jest.fn().mockResolvedValue({ items, total }),
  };
  const users = {
    findEntityById: jest.fn((id: string) =>
      Promise.resolve(
        id === GUEST_A.toString()
          ? { name: 'Sara Ahmed' }
          : id === GUEST_B.toString()
            ? { name: 'Omar Ali' }
            : null,
      ),
    ),
  };
  const service = new HotelModeratorReservationsService(
    hotels as unknown as HotelsService,
    lookup as unknown as HotelBookingLookup,
    users as unknown as UsersService,
  );
  return { service, hotels, lookup, users };
}

describe('HotelModeratorReservationsService (HTL-22)', () => {
  it("checks the moderator's own hotel first, then reads one page with the status", async () => {
    const { service, hotels, lookup } = setup();

    await service.list(
      HOTEL_ID.toString(),
      query({
        status: ModeratorReservationStatus.Cancelled,
        skip: 10,
        page: 2,
      }),
      'moderator-1',
    );

    expect(hotels.findManagedEntityOrThrow).toHaveBeenCalledWith(
      HOTEL_ID.toString(),
      'moderator-1',
    );
    expect(lookup.listForHotel).toHaveBeenCalledWith(
      HOTEL_ID,
      ModeratorReservationStatus.Cancelled,
      { skip: 10, limit: 10 },
    );
  });

  it('adds each guest name, reading each guest once, and builds the page', async () => {
    const items = [
      reservation(GUEST_A),
      reservation(GUEST_B),
      reservation(GUEST_A),
      reservation(new Types.ObjectId()),
    ];
    const { service, users } = setup(items, 14);

    const result = await service.list(
      HOTEL_ID.toString(),
      query(),
      'moderator-1',
    );

    expect(users.findEntityById).toHaveBeenCalledTimes(3);
    expect(result.items.map((item) => item.guest.name)).toEqual([
      'Sara Ahmed',
      'Omar Ali',
      'Sara Ahmed',
      null,
    ]);
    expect(result.meta).toEqual({
      page: 1,
      limit: 10,
      total: 14,
      totalPages: 2,
    });
  });

  it.each([
    [
      '404 for a hotel that does not exist',
      new NotFoundException('Hotel not found'),
    ],
    ["403 for another hotel's moderator", new ForbiddenException('Not yours')],
  ])('answers %s and reads no reservation', async (_case, refusal) => {
    const { service, hotels, lookup } = setup();
    hotels.findManagedEntityOrThrow.mockRejectedValueOnce(refusal);

    await expect(
      service.list(HOTEL_ID.toString(), query(), 'moderator-2'),
    ).rejects.toBe(refusal);
    expect(lookup.listForHotel).not.toHaveBeenCalled();
  });
});
