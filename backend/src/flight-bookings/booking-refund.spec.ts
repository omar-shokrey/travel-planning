import { Types } from 'mongoose';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { refundTiersOf } from './booking-refund';
import type { FlightBooking } from './models/flight-booking.schema';

type Segment = FlightBooking['segments'][number];

const segment = (tiers?: { daysBefore: number; refundPercent: number }[]) =>
  ({
    flightId: new Types.ObjectId(),
    airlineId: new Types.ObjectId(),
    cabin: CabinClass.Economy,
    fare: 25000,
    seatsReserved: 1,
    ...(tiers ? { cancellationTiers: tiers } : {}),
  }) as unknown as Segment;

describe('refundTiersOf (FLT-12(a))', () => {
  const OUTBOUND = [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ];
  const RETURN = [{ daysBefore: 3, refundPercent: 25 }];

  it('uses the outbound segment tiers for a whole round trip, never the return ones', () => {
    expect(
      refundTiersOf({ segments: [segment(OUTBOUND), segment(RETURN)] }),
    ).toEqual(OUTBOUND);
  });

  it('uses the only segment of a one-way booking', () => {
    expect(refundTiersOf({ segments: [segment(RETURN)] })).toEqual(RETURN);
  });

  it('keeps the stored order (highest daysBefore first) and only the two fields', () => {
    const stored = [
      { daysBefore: 14, refundPercent: 80, _id: new Types.ObjectId() },
      { daysBefore: 1, refundPercent: 10, _id: new Types.ObjectId() },
    ];

    expect(refundTiersOf({ segments: [segment(stored)] })).toEqual([
      { daysBefore: 14, refundPercent: 80 },
      { daysBefore: 1, refundPercent: 10 },
    ]);
  });

  it('gives no tier (no refund) for a booking saved before PAY-02 or with no segment', () => {
    expect(refundTiersOf({ segments: [segment(), segment(RETURN)] })).toEqual(
      [],
    );
    expect(refundTiersOf({ segments: [] })).toEqual([]);
  });

  it('returns a copy: changing it never changes the booking', () => {
    const booking = { segments: [segment(OUTBOUND)] };

    refundTiersOf(booking)[0].refundPercent = 0;

    expect(refundTiersOf(booking)[0].refundPercent).toBe(100);
  });
});
