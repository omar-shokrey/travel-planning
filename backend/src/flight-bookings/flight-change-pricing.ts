import { type BaggageRule, feeOfExtraBags } from './booking-passengers';
import { fareTotalOf } from './booking-price';
import { PassengerType } from './enums/passenger-type.enum';
import type {
  BookingSegment,
  FlightBooking,
} from './models/flight-booking.schema';
import { passengerTypeOn } from './passenger-types';

/** What one segment of a booking costs: its fares and its extra-bag fees. */
export interface SegmentPrice {
  fareTotal: number;
  baggageTotal: number;
  total: number;
}

type PricedBooking = Pick<FlightBooking, 'passengerCounts' | 'passengers'>;

/**
 * FLT-27: the price of `segments[segmentIndex]` of a booking, from what the
 * booking stored: every seat at the segment's fare and every infant at the
 * infant fare (FLT-12), plus each passenger's extra bags on that segment at
 * the segment's copied bag price (FLT-19, PAY-02). Whole minor units.
 */
export function segmentPriceOf(
  booking: PricedBooking,
  segment: Pick<BookingSegment, 'fare' | 'seatsReserved' | 'extraBagPrice'>,
  segmentIndex: number,
): SegmentPrice {
  const fareTotal = fareTotalOf(
    segment.fare,
    segment.seatsReserved,
    booking.passengerCounts.infants,
  );
  const baggageTotal = (booking.passengers ?? []).reduce(
    (sum, passenger) =>
      sum +
      (passenger.baggage ?? [])
        .filter((entry) => entry.segment === segmentIndex)
        .reduce(
          (bags, entry) => bags + entry.bags * (segment.extraBagPrice ?? 0),
          0,
        ),
    0,
  );
  return { fareTotal, baggageTotal, total: fareTotal + baggageTotal };
}

/**
 * FLT-27: whether every passenger's extra bags on `segments[segmentIndex]`
 * are allowed by the new flight's rule (its airline's price and maximum, its
 * cabin's bag weight), the same rule as a new booking (FLT-19).
 */
export function bagsFitRule(
  booking: Pick<FlightBooking, 'passengers'>,
  segmentIndex: number,
  rule: BaggageRule,
): boolean {
  let fits = true;
  for (const passenger of booking.passengers ?? []) {
    for (const entry of passenger.baggage ?? []) {
      if (entry.segment !== segmentIndex) continue;
      feeOfExtraBags(
        { bags: entry.bags, weightKg: entry.weightKg },
        rule,
        'extraBags',
        () => {
          fits = false;
        },
      );
    }
  }
  return fits;
}

/**
 * FLT-27 with FLT-12(b): the passengers keep their type, and so their fare
 * and seat. The types were derived on the outbound date, so a new outbound
 * date must give every passenger the same type; on a new return date every
 * infant must still be an infant (an infant takes no seat on the way back).
 */
export function ageGroupsUnchanged(
  booking: Pick<FlightBooking, 'passengers'>,
  segmentIndex: number,
  newDepartureDateLocal: string,
): boolean {
  return (booking.passengers ?? []).every((passenger) => {
    const type = passengerTypeOn(passenger.dateOfBirth, newDepartureDateLocal);
    return segmentIndex === 0
      ? type === passenger.type
      : passenger.type !== PassengerType.Infant ||
          type === PassengerType.Infant;
  });
}

/**
 * FLT-27: what the original payment of a booking still holds after its
 * changes, which is what a cheaper flight can be refunded from. Each
 * completed change moved the total by its difference; the dearer ones were
 * paid by their own payments, the cheaper ones refunded from the original
 * payment. So the original payment still holds the booking's total minus the
 * differences of the dearer completed changes.
 */
export function originalPaymentLeft(
  total: number,
  paidDifferences: readonly number[],
): number {
  return paidDifferences.reduce((left, paid) => left - paid, total);
}

/**
 * FLT-26 and FLT-27: the refund of a cancellation at `refundPercent`, payment
 * by payment, with the same rounding as PAY-03 (`RefundsService.refund`):
 * the percent of what the original payment still holds, plus the percent of
 * each paid difference.
 */
export function cancellationRefundOf(
  total: number,
  paidDifferences: readonly number[],
  refundPercent: number,
): number {
  const share = (amount: number) => Math.round((amount * refundPercent) / 100);
  return (
    share(originalPaymentLeft(total, paidDifferences)) +
    paidDifferences.reduce((sum, paid) => sum + share(paid), 0)
  );
}
