import { Mongoose, Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightBookingStatus } from '../enums/flight-booking-status.enum';
import { FlightBooking, FlightBookingSchema } from './flight-booking.schema';

// Validation runs in memory: no database is opened.
const FlightBookingModel = new Mongoose().model(
  FlightBooking.name,
  FlightBookingSchema,
);

const segment = (fields: Record<string, unknown> = {}) => ({
  flightId: new Types.ObjectId(),
  airlineId: new Types.ObjectId(),
  cabin: CabinClass.Economy,
  fare: 25000,
  seatsReserved: 2,
  ...fields,
});

const valid = (fields: Record<string, unknown> = {}) => ({
  userId: new Types.ObjectId(),
  status: FlightBookingStatus.PendingPayment,
  holdExpiresAt: new Date('2026-11-19T10:10:00.000Z'),
  currency: 'USD',
  fareTotal: 52500,
  total: 52500,
  segments: [segment()],
  passengerCounts: { adults: 2, children: 0, infants: 1 },
  ...fields,
});

/** The paths that fail validation, sorted. Empty when the booking is valid. */
async function invalidPaths(
  fields: Record<string, unknown>,
): Promise<string[]> {
  const error = (await new FlightBookingModel(fields)
    .validate()
    .catch((caught: unknown) => caught)) as
    { errors?: Record<string, unknown> } | undefined;
  return Object.keys(error?.errors ?? {}).sort();
}

describe('FlightBooking schema (FLT-22)', () => {
  it('is stored in the flight_bookings collection', () => {
    expect(FlightBookingModel.collection.collectionName).toBe(
      'flight_bookings',
    );
  });

  it('accepts a pending booking, with no reference until payment', async () => {
    const doc = new FlightBookingModel(valid());

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.reference).toBeUndefined();
    expect(doc.toObject()).not.toHaveProperty('reference');
  });

  it('requires every field except the reference', async () => {
    expect(await invalidPaths({})).toEqual([
      'currency',
      'fareTotal',
      'passengerCounts',
      'segments',
      'status',
      'total',
      'userId',
    ]);
  });

  it('requires holdExpiresAt only while the payment is pending', async () => {
    expect(await invalidPaths(valid({ holdExpiresAt: undefined }))).toEqual([
      'holdExpiresAt',
    ]);
    expect(
      await invalidPaths(
        valid({
          status: FlightBookingStatus.Confirmed,
          holdExpiresAt: undefined,
        }),
      ),
    ).toEqual([]);
  });

  it('stores the status as a text limited to the GEN-11 values', async () => {
    expect(FlightBookingSchema.path('status').options).toMatchObject({
      type: String,
      required: true,
      enum: Object.values(FlightBookingStatus),
    });
    expect(Object.values(FlightBookingStatus)).toEqual([
      'pending_payment',
      'confirmed',
      'completed',
      'expired',
      'cancelled',
    ]);
    for (const status of Object.values(FlightBookingStatus)) {
      expect(await invalidPaths(valid({ status }))).toEqual([]);
    }
    expect(await invalidPaths(valid({ status: 'paid' }))).toEqual(['status']);
  });

  it('keeps money in whole minor units of 0 or more', async () => {
    expect(await invalidPaths(valid({ fareTotal: 10.5 }))).toEqual([
      'fareTotal',
    ]);
    expect(await invalidPaths(valid({ total: 10.5 }))).toEqual(['total']);
    expect(await invalidPaths(valid({ total: -1 }))).toEqual(['total']);
    expect(
      await invalidPaths(valid({ segments: [segment({ fare: 99.5 })] })),
    ).toEqual(['segments.0.fare']);
    expect(
      await invalidPaths(valid({ segments: [segment({ fare: 0 })] })),
    ).toEqual(['segments.0.fare']);
  });

  it('has one or two segments, each with a known cabin and whole seats', async () => {
    expect(await invalidPaths(valid({ segments: [] }))).toEqual(['segments']);
    expect(
      await invalidPaths(
        valid({ segments: [segment(), segment(), segment()] }),
      ),
    ).toEqual(['segments']);
    expect(
      await invalidPaths(valid({ segments: [segment({ cabin: 'deluxe' })] })),
    ).toEqual(['segments.0.cabin']);
    expect(
      await invalidPaths(
        valid({ segments: [segment({ seatsReserved: 1.5 })] }),
      ),
    ).toEqual(['segments.0.seatsReserved']);
    expect(
      await invalidPaths(valid({ segments: [segment({ seatsReserved: 0 })] })),
    ).toEqual(['segments.0.seatsReserved']);
  });

  it('needs at least one adult and whole passenger counts', async () => {
    expect(
      await invalidPaths(
        valid({ passengerCounts: { adults: 0, children: 1, infants: 0 } }),
      ),
    ).toEqual(['passengerCounts.adults']);
    expect(
      await invalidPaths(
        valid({ passengerCounts: { adults: 1, children: 0.5, infants: 0 } }),
      ),
    ).toEqual(['passengerCounts.children']);
  });

  it('has the four indexes of the data model', () => {
    const indexes = FlightBookingSchema.indexes();

    expect(indexes).toHaveLength(4);
    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          { reference: 1 },
          expect.objectContaining({ unique: true, sparse: true }),
        ],
        [{ userId: 1, status: 1 }, expect.anything()],
        [{ 'segments.flightId': 1 }, expect.anything()],
        [{ status: 1, holdExpiresAt: 1 }, expect.anything()],
      ]),
    );
  });
});
