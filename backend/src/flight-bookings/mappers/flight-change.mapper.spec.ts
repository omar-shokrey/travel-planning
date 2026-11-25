import { Types } from 'mongoose';
import type { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightChangeStatus } from '../enums/flight-change-status.enum';
import {
  type FlightChangeQuote,
  type FlightChangeSource,
  toFlightChangeResponse,
  toFlightChangeSummary,
  toSegmentPolicies,
} from './flight-change.mapper';

const FROM = new Types.ObjectId('6740f1c2a4b5c6d7e8f90456');
const TO = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');
const CHANGE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90ccc');
const BOOKING = new Types.ObjectId('6740f1c2a4b5c6d7e8f90aaa');
const NOW = new Date('2026-11-20T10:00:00.000Z');
const HOLD = new Date('2026-11-20T10:10:00.000Z');

const newSegment = {
  flightId: TO,
  airlineId: new Types.ObjectId(),
  cabin: CabinClass.Economy,
  fare: 14_000,
  seatsReserved: 2,
  cancellationTiers: [{ daysBefore: 30, refundPercent: 80 }],
  extraBagPrice: 4500,
  maxExtraBags: 2,
  freeBags: 1,
  maxBagKg: 23,
};

const quote: FlightChangeQuote = {
  bookingId: BOOKING.toString(),
  segmentIndex: 0,
  cabin: CabinClass.Economy,
  fromFlight: { id: FROM.toString() } as FlightResponseDto,
  toFlight: { id: TO.toString() } as FlightResponseDto,
  oldSegmentTotal: 24_000,
  newSegmentTotal: 28_200,
  difference: 4200,
  newTotal: 52_200,
  currency: 'USD',
  newSegment,
};

describe('toSegmentPolicies (FLT-27)', () => {
  it("shows the new segment's tiers and bag rules like PAY-02, and nulls for what is unset", () => {
    expect(toSegmentPolicies(newSegment, 'USD')).toEqual({
      flightId: TO.toString(),
      cabin: CabinClass.Economy,
      cancellationTiers: [{ daysBefore: 30, refundPercent: 80 }],
      baggage: {
        freeBags: 1,
        maxBagKg: 23,
        extraBagPrice: 4500,
        maxExtraBags: 2,
        currency: 'USD',
      },
    });
    expect(
      toSegmentPolicies(
        {
          ...newSegment,
          extraBagPrice: undefined,
          freeBags: undefined,
          maxBagKg: undefined,
          cancellationTiers: [],
        },
        'USD',
      ).baggage,
    ).toEqual({
      freeBags: null,
      maxBagKg: null,
      extraBagPrice: null,
      maxExtraBags: 2,
      currency: 'USD',
    });
  });
});

describe('toFlightChangeResponse (FLT-27)', () => {
  it('answers a dry run as a quote with no id, hold, payment or refund', () => {
    expect(toFlightChangeResponse(quote)).toEqual({
      id: null,
      bookingId: BOOKING.toString(),
      status: 'quote',
      segmentIndex: 0,
      cabin: CabinClass.Economy,
      fromFlight: { id: FROM.toString() },
      toFlight: { id: TO.toString() },
      oldSegmentTotal: 24_000,
      newSegmentTotal: 28_200,
      difference: 4200,
      newTotal: 52_200,
      currency: 'USD',
      newPolicies: toSegmentPolicies(newSegment, 'USD'),
      holdExpiresAt: null,
      payment: null,
      refund: null,
    });
  });

  it('answers a dearer change waiting for payment with its hold and how to pay it', () => {
    const answer = toFlightChangeResponse(quote, {
      _id: CHANGE,
      status: FlightChangeStatus.PendingPayment,
      holdExpiresAt: HOLD,
    });

    expect(answer).toMatchObject({
      id: CHANGE.toString(),
      status: 'pending_payment',
      holdExpiresAt: HOLD.toISOString(),
      payment: { bookingType: 'flight_change', bookingId: CHANGE.toString() },
      refund: null,
    });
  });

  it('answers a completed cheaper change with its refund and no hold or payment', () => {
    const refund = {
      id: 'r1',
      status: 'pending',
      amount: 4000,
      currency: 'USD',
      refundPercent: 16,
    };

    expect(
      toFlightChangeResponse(
        { ...quote, difference: -4000 },
        {
          _id: CHANGE,
          status: FlightChangeStatus.Completed,
          holdExpiresAt: HOLD,
        },
        refund as never,
      ),
    ).toMatchObject({
      status: 'completed',
      holdExpiresAt: null,
      payment: null,
      refund,
    });
  });
});

describe('toFlightChangeSummary (FLT-27)', () => {
  const change = (fields: Partial<FlightChangeSource> = {}) =>
    ({
      _id: CHANGE,
      bookingId: BOOKING,
      status: FlightChangeStatus.Completed,
      segmentIndex: 1,
      fromFlightId: FROM,
      toFlightId: TO,
      difference: -4000,
      currency: 'USD',
      holdExpiresAt: undefined,
      createdAt: NOW,
      completedAt: NOW,
      ...fields,
    }) as FlightChangeSource;

  it('shows ids as strings, UTC dates, the difference and the refund', () => {
    expect(toFlightChangeSummary(change(), null)).toEqual({
      id: CHANGE.toString(),
      status: 'completed',
      segmentIndex: 1,
      fromFlightId: FROM.toString(),
      toFlightId: TO.toString(),
      difference: -4000,
      currency: 'USD',
      holdExpiresAt: null,
      createdAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      refund: null,
    });
  });

  it('shows the hold only while it waits for payment, and never the internal fields', () => {
    const waiting = toFlightChangeSummary(
      change({
        status: FlightChangeStatus.PendingPayment,
        holdExpiresAt: HOLD,
        completedAt: undefined,
      }),
    );
    const expired = toFlightChangeSummary(
      change({ status: FlightChangeStatus.Expired, holdExpiresAt: HOLD }),
    );

    expect(waiting.holdExpiresAt).toBe(HOLD.toISOString());
    expect(waiting.completedAt).toBeNull();
    expect(expired.holdExpiresAt).toBeNull();
    expect(Object.keys(waiting)).not.toEqual(
      expect.arrayContaining(['userId', 'open', 'seatsBookedAt', 'newSegment']),
    );
  });
});
