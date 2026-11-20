import type { Types } from 'mongoose';
import type { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import type { CabinClass } from '../../flights/models/cabin-class.enum';
import type { FlightSegmentPoliciesDto } from '../../payments/dto/booking-policies-response.dto';
import type { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import type {
  FlightChangeAnswerStatus,
  FlightChangeResponseDto,
  FlightChangeSummaryDto,
} from '../dto/flight-change-response.dto';
import { FlightChangeStatus } from '../enums/flight-change-status.enum';
import type { FlightBookingChange } from '../models/flight-booking-change.schema';
import type { BookingSegment } from '../models/flight-booking.schema';

export type FlightChangeSource = FlightBookingChange & { _id: Types.ObjectId };

/** FLT-27: the new segment's policies, as PAY-02 shows a booking's (tiers, bag rules). */
export function toSegmentPolicies(
  segment: BookingSegment,
  currency: string,
): FlightSegmentPoliciesDto {
  return {
    flightId: segment.flightId.toString(),
    cabin: segment.cabin,
    cancellationTiers: (segment.cancellationTiers ?? []).map(
      ({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }),
    ),
    baggage: {
      freeBags: segment.freeBags ?? null,
      maxBagKg: segment.maxBagKg ?? null,
      extraBagPrice: segment.extraBagPrice ?? null,
      maxExtraBags: segment.maxExtraBags ?? 0,
      currency,
    },
  };
}

/** What a dry run worked out, and what a change stores. */
export interface FlightChangeQuote {
  bookingId: string;
  segmentIndex: number;
  cabin: CabinClass;
  fromFlight: FlightResponseDto | null;
  toFlight: FlightResponseDto;
  oldSegmentTotal: number;
  newSegmentTotal: number;
  difference: number;
  newTotal: number;
  currency: string;
  newSegment: BookingSegment;
}

/**
 * FLT-27: the answer of the change route: the quote alone for a dry run
 * (`stored` absent), or the stored change with its hold, how to pay it, and
 * the refund of a cheaper flight.
 */
export function toFlightChangeResponse(
  quote: FlightChangeQuote,
  stored?: Pick<FlightChangeSource, '_id' | 'status' | 'holdExpiresAt'>,
  refund: RefundSummaryDto | null = null,
): FlightChangeResponseDto {
  const status: FlightChangeAnswerStatus = stored ? stored.status : 'quote';
  const waiting = stored?.status === FlightChangeStatus.PendingPayment;
  return {
    id: stored ? stored._id.toString() : null,
    bookingId: quote.bookingId,
    status,
    segmentIndex: quote.segmentIndex,
    cabin: quote.cabin,
    fromFlight: quote.fromFlight,
    toFlight: quote.toFlight,
    oldSegmentTotal: quote.oldSegmentTotal,
    newSegmentTotal: quote.newSegmentTotal,
    difference: quote.difference,
    newTotal: quote.newTotal,
    currency: quote.currency,
    newPolicies: toSegmentPolicies(quote.newSegment, quote.currency),
    holdExpiresAt:
      waiting && stored?.holdExpiresAt
        ? stored.holdExpiresAt.toISOString()
        : null,
    payment:
      waiting && stored
        ? { bookingType: 'flight_change', bookingId: stored._id.toString() }
        : null,
    refund,
  };
}

/** FLT-27: one change as the booking details (with its refund) and lists show it. */
export function toFlightChangeSummary(
  change: FlightChangeSource,
  refund: RefundSummaryDto | null = null,
): FlightChangeSummaryDto {
  return {
    id: change._id.toString(),
    status: change.status,
    segmentIndex: change.segmentIndex,
    fromFlightId: change.fromFlightId.toString(),
    toFlightId: change.toFlightId.toString(),
    difference: change.difference,
    currency: change.currency,
    holdExpiresAt:
      change.status === FlightChangeStatus.PendingPayment &&
      change.holdExpiresAt
        ? change.holdExpiresAt.toISOString()
        : null,
    createdAt: change.createdAt.toISOString(),
    completedAt: change.completedAt?.toISOString() ?? null,
    refund,
  };
}
