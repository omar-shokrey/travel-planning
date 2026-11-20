import { Types } from 'mongoose';
import { HotelBookingStatus } from '../hotel-bookings/enums/hotel-booking-status.enum';
import {
  HotelBookingLookup,
  ModeratorReservationStatus,
} from './hotel-booking-lookup.service';

const HOTEL_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const ROOM_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90124');

function setup() {
  const collection = {
    findOne: jest.fn(),
    // Any write method called by mistake fails the test.
    insertOne: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const connection = { collection: jest.fn().mockReturnValue(collection) };
  const lookup = new HotelBookingLookup(connection as never);
  const noWrite = () => {
    for (const method of [
      'insertOne',
      'updateOne',
      'updateMany',
      'deleteOne',
      'deleteMany',
      'findOneAndUpdate',
    ] as const) {
      expect(collection[method]).not.toHaveBeenCalled();
    }
  };
  return { lookup, collection, connection, noWrite };
}

describe('HotelBookingLookup (HTL-06, HTL-18)', () => {
  it('finds a reservation of the hotel that names the room, in any status', async () => {
    const { lookup, collection, connection, noWrite } = setup();
    collection.findOne.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(lookup.wasEverReserved(HOTEL_ID, ROOM_ID)).resolves.toBe(true);

    expect(connection.collection).toHaveBeenCalledWith('hotel_bookings');
    // No status filter: an expired or cancelled reservation counts too.
    expect(collection.findOne).toHaveBeenCalledWith(
      { hotelId: HOTEL_ID, 'rooms.roomId': ROOM_ID },
      { projection: { _id: 1 } },
    );
    noWrite();
  });

  it('answers false when no reservation names the room', async () => {
    const { lookup, collection, noWrite } = setup();
    collection.findOne.mockResolvedValue(null);

    await expect(lookup.wasEverReserved(HOTEL_ID, ROOM_ID)).resolves.toBe(
      false,
    );
    noWrite();
  });
});

describe('HotelBookingLookup.listForHotel (HTL-22)', () => {
  const build = (page: unknown[] = [], total = page.length) => {
    const cursor = {
      sort: jest.fn(),
      skip: jest.fn(),
      limit: jest.fn(),
      toArray: jest.fn().mockResolvedValue(page),
    };
    cursor.sort.mockReturnValue(cursor);
    cursor.skip.mockReturnValue(cursor);
    cursor.limit.mockReturnValue(cursor);
    const collection = {
      find: jest.fn().mockReturnValue(cursor),
      countDocuments: jest.fn().mockResolvedValue(total),
      insertOne: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
      deleteOne: jest.fn(),
      deleteMany: jest.fn(),
    };
    const connection = { collection: jest.fn().mockReturnValue(collection) };
    return {
      lookup: new HotelBookingLookup(connection as never),
      collection,
      cursor,
      connection,
    };
  };

  it('reads one page of the hotel, in the visible statuses, newest check-in first, and counts with the same filter', async () => {
    const page = [{ _id: new Types.ObjectId() }];
    const { lookup, collection, cursor, connection } = build(page, 12);

    const result = await lookup.listForHotel(HOTEL_ID, undefined, {
      skip: 10,
      limit: 10,
    });

    const filter = {
      hotelId: HOTEL_ID,
      status: { $in: ['confirmed', 'completed', 'cancelled'] },
    };
    expect(connection.collection).toHaveBeenCalledWith('hotel_bookings');
    expect(collection.find).toHaveBeenCalledWith(filter, {
      projection: expect.objectContaining({ userId: 1, status: 1 }),
    });
    expect(collection.countDocuments).toHaveBeenCalledWith(filter);
    expect(cursor.sort).toHaveBeenCalledWith({ checkIn: -1, _id: -1 });
    expect(cursor.skip).toHaveBeenCalledWith(10);
    expect(cursor.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({ items: page, total: 12 });
  });

  it('filters on one status when asked', async () => {
    const { lookup, collection } = build();

    await lookup.listForHotel(HOTEL_ID, ModeratorReservationStatus.Cancelled, {
      skip: 0,
      limit: 10,
    });

    expect(collection.find).toHaveBeenCalledWith(
      { hotelId: HOTEL_ID, status: 'cancelled' },
      expect.anything(),
    );
  });

  it('never reads a price, a payment, a hold or a policy field, and never writes', async () => {
    const { lookup, collection } = build();

    await lookup.listForHotel(HOTEL_ID, undefined, { skip: 0, limit: 10 });

    const [, options] = collection.find.mock.calls[0] as [
      unknown,
      { projection: Record<string, number> },
    ];
    for (const field of [
      'total',
      'currency',
      'rooms.pricePerNight',
      'holdExpiresAt',
      'policyAcceptedAt',
      'cancellationTiers',
    ]) {
      expect(options.projection).not.toHaveProperty([field]);
    }
    for (const method of [
      'insertOne',
      'updateOne',
      'updateMany',
      'deleteOne',
      'deleteMany',
    ] as const) {
      expect(collection[method]).not.toHaveBeenCalled();
    }
  });

  it('uses the status values of the hotel-bookings module', () => {
    for (const value of Object.values(ModeratorReservationStatus)) {
      expect(Object.values(HotelBookingStatus)).toContain(value);
    }
  });
});
