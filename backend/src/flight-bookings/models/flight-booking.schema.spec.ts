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

  it('has no policyAcceptedAt until the policies are accepted (PAY-02)', async () => {
    const pending = new FlightBookingModel(valid());

    expect(pending.policyAcceptedAt).toBeUndefined();
    expect(pending.toObject()).not.toHaveProperty('policyAcceptedAt');
    expect(FlightBookingSchema.path('policyAcceptedAt').options).toMatchObject({
      type: Date,
    });
    expect(FlightBookingSchema.path('policyAcceptedAt').isRequired).toBeFalsy();

    const acceptedAt = new Date('2026-11-19T10:02:00.000Z');
    const accepted = new FlightBookingModel(
      valid({ policyAcceptedAt: acceptedAt }),
    );
    await expect(accepted.validate()).resolves.toBeUndefined();
    expect(accepted.policyAcceptedAt).toEqual(acceptedAt);
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

  it('gives a segment without a policy copy no tiers and 0 extra bags (PAY-02)', async () => {
    const doc = new FlightBookingModel(valid());

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.segments[0].cancellationTiers).toEqual([]);
    expect(doc.segments[0].maxExtraBags).toBe(0);
    expect(doc.segments[0].extraBagPrice).toBeUndefined();
    expect(doc.segments[0].freeBags).toBeUndefined();
    expect(doc.segments[0].maxBagKg).toBeUndefined();
  });

  it('keeps the copied policy in whole numbers (PAY-02)', async () => {
    expect(
      await invalidPaths(
        valid({
          segments: [
            segment({
              cancellationTiers: [{ daysBefore: 7, refundPercent: 50.5 }],
              extraBagPrice: 10.5,
              maxExtraBags: 1.5,
              freeBags: -1,
              maxBagKg: 0,
            }),
          ],
        }),
      ),
    ).toEqual([
      'segments.0.cancellationTiers.0.refundPercent',
      'segments.0.extraBagPrice',
      'segments.0.freeBags',
      'segments.0.maxBagKg',
      'segments.0.maxExtraBags',
    ]);
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

describe('FlightBooking schema, passengers and baggage (FLT-19)', () => {
  const passenger = (fields: Record<string, unknown> = {}) => ({
    fullName: 'Sara Ahmed',
    dateOfBirth: '1990-05-14',
    passportNumber: 'A12345678',
    type: 'adult',
    ...fields,
  });

  /** The validation messages, to check that no personal value is repeated. */
  async function messagesOf(fields: Record<string, unknown>): Promise<string> {
    const error = (await new FlightBookingModel(fields)
      .validate()
      .catch((caught: unknown) => caught)) as
      { errors?: Record<string, { message: string }> } | undefined;
    return Object.values(error?.errors ?? {})
      .map(({ message }) => message)
      .join(' | ');
  }

  it('accepts passengers with extra bags and a baggage total', async () => {
    expect(
      await invalidPaths(
        valid({
          baggageTotal: 4500,
          total: 57000,
          passengers: [
            passenger({ baggage: [{ segment: 0, bags: 1, weightKg: 20 }] }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('defaults to no passengers, no bags and a baggage total of 0 (bookings saved before FLT-19)', () => {
    const booking = new FlightBookingModel(
      valid({ passengers: [passenger()] }),
    );
    const before = new FlightBookingModel(valid());

    expect(booking.passengers[0].baggage).toEqual([]);
    expect(before.passengers).toEqual([]);
    expect(before.baggageTotal).toBe(0);
  });

  it('stores the date of birth as a YYYY-MM-DD text, never a Date', async () => {
    const booking = new FlightBookingModel(
      valid({ passengers: [passenger()] }),
    );

    expect(booking.passengers[0].dateOfBirth).toBe('1990-05-14');
    expect(
      await invalidPaths(
        valid({ passengers: [passenger({ dateOfBirth: '14/05/1990' })] }),
      ),
    ).toEqual(['passengers.0.dateOfBirth']);
  });

  it('keeps the type to adult, child or infant', async () => {
    expect(
      await invalidPaths(
        valid({ passengers: [passenger({ type: 'senior' })] }),
      ),
    ).toEqual(['passengers.0.type']);
  });

  it('keeps the baggage total and the bags in whole numbers', async () => {
    expect(await invalidPaths(valid({ baggageTotal: 10.5 }))).toEqual([
      'baggageTotal',
    ]);
    expect(await invalidPaths(valid({ baggageTotal: -1 }))).toEqual([
      'baggageTotal',
    ]);
    expect(
      await invalidPaths(
        valid({
          passengers: [
            passenger({ baggage: [{ segment: 2, bags: 0, weightKg: 1.5 }] }),
          ],
        }),
      ),
    ).toEqual([
      'passengers.0.baggage.0.bags',
      'passengers.0.baggage.0.segment',
      'passengers.0.baggage.0.weightKg',
    ]);
  });

  it('has at most 18 passengers', async () => {
    const many = Array.from({ length: 19 }, (_, index) =>
      passenger({ passportNumber: `P${10000 + index}` }),
    );
    expect(await invalidPaths(valid({ passengers: many }))).toEqual([
      'passengers',
    ]);
  });

  it('never repeats a personal value in a validation message', async () => {
    const messages = await messagesOf(
      valid({
        passengers: [
          passenger({
            dateOfBirth: 'born-1990',
            passportNumber: 'secret-pass',
            fullName: 'N'.repeat(101),
          }),
        ],
      }),
    );

    expect(messages).not.toBe('');
    for (const value of ['born-1990', 'secret-pass', 'N'.repeat(101)]) {
      expect(messages).not.toContain(value);
    }
  });
});
