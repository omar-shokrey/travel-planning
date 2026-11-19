import type { FlightBooking } from './models/flight-booking.schema';

/** One refund tier as copied into a segment (PAY-02). */
export interface RefundTier {
  daysBefore: number;
  refundPercent: number;
}

/**
 * FLT-12(a): a round trip is one booking and is cancelled as a whole, with the
 * tiers of its first (outbound) segment: the airline's tiers copied when the
 * seats were held (PAY-02), highest `daysBefore` first. The return segment's
 * tiers are kept for the record but never decide a refund. A one-way booking
 * has only that segment. No segment, or no copied tiers (a booking saved
 * before PAY-02), means no tier: no refund.
 *
 * The cancellation itself (FLT-26) is not built yet; it must use this, never
 * the airline's current tiers and never the return segment's.
 */
export function refundTiersOf(
  booking: Pick<FlightBooking, 'segments'>,
): RefundTier[] {
  return (booking.segments[0]?.cancellationTiers ?? []).map(
    ({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }),
  );
}
