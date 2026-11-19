import { Types } from 'mongoose';
import { HotelBookingLookup } from './hotel-booking-lookup.service';

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
