import { Types } from 'mongoose';
import { FlightBookingLookup } from './flight-booking-lookup.service';

const FLIGHT_ID = '6740f1c2a4b5c6d7e8f90456';

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
  const lookup = new FlightBookingLookup(connection as never);
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

describe('FlightBookingLookup (FLT-05, until FLT-21)', () => {
  it('finds a booking waiting for its payment or confirmed, and reads only its id', async () => {
    const { lookup, collection, noWrite } = setup();
    collection.findOne.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(lookup.hasActiveBooking(FLIGHT_ID)).resolves.toBe(true);

    expect(collection.findOne).toHaveBeenCalledWith(
      {
        'segments.flightId': new Types.ObjectId(FLIGHT_ID),
        status: { $in: ['pending_payment', 'confirmed'] },
      },
      { projection: { _id: 1 } },
    );
    noWrite();
  });

  it('answers false when no such booking exists (expired and cancelled ones are not asked for)', async () => {
    const { lookup, collection } = setup();
    collection.findOne.mockResolvedValue(null);

    await expect(lookup.hasActiveBooking(FLIGHT_ID)).resolves.toBe(false);
  });
});
