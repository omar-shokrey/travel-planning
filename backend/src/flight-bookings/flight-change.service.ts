import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import { AirlinesService } from '../flights/airlines.service';
import { FlightResponsesService } from '../flights/flight-responses.service';
import { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { toLocalTime } from '../flights/flight-local-time';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { Flight } from '../flights/models/flight.schema';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import type { RefundSummaryDto } from '../payments/refunds/dto/refund-response.dto';
import { REFUND_EXCEEDS_PAYMENT_MESSAGE } from '../payments/refunds/refunds.constants';
import { RefundsService } from '../payments/refunds/refunds.service';
import { bookingChangedMessage } from './booking-change-message';
import type { ChangeFlightDto } from './dto/change-flight.dto';
import type {
  FlightChangeResponseDto,
  FlightChangeSummaryDto,
} from './dto/flight-change-response.dto';
import { CancelledBy } from './enums/cancelled-by.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FlightChangeStatus } from './enums/flight-change-status.enum';
import {
  CHANGE_AGE_GROUP_MESSAGE,
  CHANGE_BAGS_MESSAGE,
  CHANGE_BOOKING_CHANGED_MESSAGE,
  CHANGE_DEPARTED_MESSAGE,
  CHANGE_DIFFERENCE_CHANGED_MESSAGE,
  CHANGE_IN_PROGRESS_MESSAGE,
  CHANGE_NOT_CONFIRMED_MESSAGE,
  CHANGE_REFUND_TOO_LARGE_MESSAGE,
  FLIGHT_BOOKING_HOLD_MINUTES,
  FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE,
  FLIGHT_CHANGE_JOB_BATCH_SIZE,
  FLIGHT_CHANGE_STUCK_AFTER_MS,
  OUTBOUND_AFTER_RETURN_MESSAGE,
  RETURN_TOO_EARLY_MESSAGE,
  SAME_FLIGHT_MESSAGE,
  changeRouteMessage,
} from './flight-bookings.constants';
import {
  BOOKING_NOT_FOUND_MESSAGE,
  baggageRuleOf,
  readFlightForBooking,
  returnLeavesAfterArrival,
} from './flight-bookings.service';
import {
  ageGroupsUnchanged,
  bagsFitRule,
  originalPaymentLeft,
  segmentPriceOf,
} from './flight-change-pricing';
import { FlightSeatsService } from './flight-seats.service';
import type { FlightBookingSource } from './mappers/flight-booking.mapper';
import {
  type FlightChangeQuote,
  type FlightChangeSource,
  toFlightChangeResponse,
  toFlightChangeSummary,
} from './mappers/flight-change.mapper';
import { FlightBookingChange } from './models/flight-booking-change.schema';
import {
  type BookingSegment,
  FlightBooking,
} from './models/flight-booking.schema';
import { resolveSegmentIndex } from './seat-selection-rules';

const MONGO_DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error as { code?: unknown }).code === MONGO_DUPLICATE_KEY;

/**
 * A refund of a cheaper fare that can never succeed automatically: more than
 * the payment still holds, or no succeeded payment. Anything else (another
 * refund of the payment at the same moment, the database) is tried again.
 */
const isFinalRefundFailure = (error: unknown): boolean =>
  error instanceof NotFoundException ||
  (error instanceof ConflictException &&
    error.message === REFUND_EXCEEDS_PAYMENT_MESSAGE);

const badRequest = (errors: FieldError[]) =>
  new BadRequestException({ message: 'Validation failed', errors });

/** What applying a change ended with. */
type ApplyResult = 'completed' | 'abandoned' | 'unfinished';

/** A quote with what the change needs to be stored, before anything is held. */
interface PlannedChange extends FlightChangeQuote {
  booking: FlightBookingSource;
  fromFlightId: Types.ObjectId;
  toFlightId: Types.ObjectId;
  seats: number;
  newFareTotal: number;
  newBaggageTotal: number;
  /** The new flight's local departure date and its cabin's bag weight, as checked. */
  toDepartureDateLocal: string;
  toMaxBagKg: number | undefined;
}

/**
 * FLT-27: a registered user changes one flight of their own confirmed
 * booking to another flight on the same route, in the same cabin, subject to
 * seat availability. A dearer flight's fare difference is paid with Stripe
 * (PAY-01, `bookingType: flight_change`), a cheaper one's is refunded
 * (PAY-03), an equal one changes at once.
 *
 * Each change is a document of `flight_booking_changes`; one open change per
 * booking (a partial unique index). The new flight's seats are held with the
 * same atomic update as a booking (FLT-22). Applying a change moves the
 * held seats to booked, swaps the segment with ONE conditional update of the
 * booking (still confirmed, still on the old flight), then gives the old
 * flight's seats back, frees the chosen seats of that segment (FLT-28),
 * refunds a cheaper fare and notifies the owner. Each seat step is claimed
 * on the change first, so a retry never repeats it; the change job finishes
 * a change a crash left `applying`.
 */
@Injectable()
export class FlightChangeService {
  private readonly logger = new Logger(FlightChangeService.name);

  constructor(
    @InjectModel(FlightBookingChange.name)
    private readonly changes: Model<FlightBookingChange>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    // Read only: the booked flights' times and the new flight before the hold.
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly airlines: AirlinesService,
    private readonly seatHolds: FlightSeatHoldsService,
    private readonly flightResponses: FlightResponsesService,
    private readonly refunds: RefundsService,
    private readonly seatAssignments: FlightSeatsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * PATCH /api/flight-bookings/:id/change-flight. A dry run only answers the
   * quote. Otherwise the difference must still be `expectedDifference` (409
   * otherwise, nothing changed), the change is recorded (409 while another
   * change of the booking is open), the new seats are held, and then a
   * dearer flight waits for its payment (`pending_payment`, 10 minutes) while
   * an equal or cheaper one is applied at once (`completed`).
   */
  async change(
    id: string,
    userId: string,
    dto: ChangeFlightDto,
    now: Date = new Date(),
  ): Promise<FlightChangeResponseDto> {
    const planned = await this.plan(id, userId, dto, now);
    if (dto.dryRun === true) {
      return toFlightChangeResponse(planned);
    }
    if (planned.difference !== dto.expectedDifference) {
      throw new ConflictException(CHANGE_DIFFERENCE_CHANGED_MESSAGE);
    }
    if (planned.difference < 0) {
      const paid = await this.paidDifferencesOf(planned.booking._id);
      const left = originalPaymentLeft(
        planned.booking.total,
        paid.map((change) => change.difference),
      );
      if (-planned.difference > left) {
        throw new ConflictException(CHANGE_REFUND_TOO_LARGE_MESSAGE);
      }
    }

    const dearer = planned.difference > 0;
    let change: FlightChangeSource;
    try {
      change = (
        await this.changes.create({
          bookingId: planned.booking._id,
          userId: planned.booking.userId,
          segmentIndex: planned.segmentIndex,
          cabin: planned.cabin,
          seats: planned.seats,
          fromFlightId: planned.fromFlightId,
          toFlightId: planned.toFlightId,
          currency: planned.currency,
          oldSegmentTotal: planned.oldSegmentTotal,
          newSegmentTotal: planned.newSegmentTotal,
          difference: planned.difference,
          newSegment: planned.newSegment,
          totalBefore: planned.booking.total,
          newFareTotal: planned.newFareTotal,
          newBaggageTotal: planned.newBaggageTotal,
          newTotal: planned.newTotal,
          status: dearer
            ? FlightChangeStatus.PendingPayment
            : FlightChangeStatus.Applying,
          open: true,
          policyAcceptedAt: now,
          ...(dearer && {
            holdExpiresAt: new Date(
              now.getTime() + FLIGHT_BOOKING_HOLD_MINUTES * 60 * 1000,
            ),
          }),
        })
      ).toObject();
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(CHANGE_IN_PROGRESS_MESSAGE);
      }
      throw error;
    }

    try {
      const held = await this.seatHolds.hold(
        planned.toFlightId,
        planned.cabin,
        planned.seats,
        now,
      );
      change = { ...change, heldAt: now };
      await this.changes
        .updateOne({ _id: change._id }, { $set: { heldAt: now } })
        .exec();
      // The price, the date and the bag weight were checked before the hold:
      // if the flight changed in between (FLT-05), the quote is no longer it.
      const cabin = held.cabins.find((c) => c.cabin === planned.cabin);
      const heldFlight = held as typeof held & { departureDateLocal?: string };
      if (
        !cabin ||
        cabin.price !== planned.newSegment.fare ||
        cabin.maxBagKg !== planned.toMaxBagKg ||
        heldFlight.departureDateLocal !== planned.toDepartureDateLocal
      ) {
        await this.releaseHeld(change, 'its flight changed during the hold');
        throw new ConflictException(CHANGE_DIFFERENCE_CHANGED_MESSAGE);
      }
    } catch (error) {
      // Nothing was held (or it was just given back): the change never happened.
      await this.markExpired(change._id, now);
      throw error;
    }

    if (dearer) {
      return toFlightChangeResponse(planned, change);
    }
    const result = await this.apply(change, now);
    if (result === 'abandoned') {
      throw new ConflictException(CHANGE_BOOKING_CHANGED_MESSAGE);
    }
    const stored = await this.changes
      .findById(change._id)
      .lean<FlightChangeSource>()
      .orFail()
      .exec();
    const refund =
      planned.difference < 0
        ? await this.refunds.findSummaryByBooking(
            BookingType.FlightChange,
            change._id.toString(),
          )
        : null;
    return toFlightChangeResponse(planned, stored, refund);
  }

  /**
   * Every check, in this order, before anything is written: the booking is
   * the owner's (404) and confirmed (409); `segmentIndex` names one of its
   * flights (400); the new flight is another flight (400); the booked flight
   * has not departed and was not cancelled by its airline (409); the new
   * flight is read as a booking reads it (404 missing or a deactivated
   * airline, 409 no longer bookable, 404 without the booked cabin); it flies
   * the same route (400) and keeps a round trip in order (400); every
   * passenger keeps their age group (409) and their extra bags fit the new
   * rule (409). Then the price of the segment before and after.
   */
  private async plan(
    id: string,
    userId: string,
    dto: ChangeFlightDto,
    now: Date,
  ): Promise<PlannedChange> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean<FlightBookingSource>()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    if (booking.status !== FlightBookingStatus.Confirmed) {
      throw new ConflictException(CHANGE_NOT_CONFIRMED_MESSAGE);
    }
    const choice = resolveSegmentIndex(
      booking.segments.length,
      dto.segmentIndex,
    );
    if (choice.error) {
      throw badRequest([choice.error]);
    }
    const segmentIndex = choice.segmentIndex;
    const segment = booking.segments[segmentIndex];
    if (segment.flightId.toString() === dto.newFlightId) {
      throw badRequest([
        { field: 'newFlightId', messages: [SAME_FLIGHT_MESSAGE] },
      ]);
    }

    const booked = await this.flights
      .find({ _id: { $in: booking.segments.map((s) => s.flightId) } })
      .lean()
      .exec();
    const flightOf = (index: number) =>
      booked.find((flight) =>
        flight._id.equals(booking.segments[index].flightId),
      );
    const from = flightOf(segmentIndex);
    // A flight that no longer exists cannot be checked: it counts as departed.
    if (!from || from.departureAt.getTime() <= now.getTime()) {
      throw new ConflictException(CHANGE_DEPARTED_MESSAGE);
    }
    if (from.status === FlightStatus.Cancelled) {
      throw new ConflictException(FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE);
    }

    const to = await readFlightForBooking(
      this.flights,
      this.airlines,
      dto.newFlightId,
      segment.cabin,
      now,
    );

    const errors: FieldError[] = [];
    if (
      to.flight.departureAirport !== from.departureAirport ||
      to.flight.arrivalAirport !== from.arrivalAirport
    ) {
      errors.push({
        field: 'newFlightId',
        messages: [
          changeRouteMessage(from.departureAirport, from.arrivalAirport),
        ],
      });
    } else if (booking.segments.length === 2) {
      const other = flightOf(segmentIndex === 0 ? 1 : 0);
      const inOrder =
        !other ||
        (segmentIndex === 0
          ? returnLeavesAfterArrival(to.flight, other)
          : returnLeavesAfterArrival(other, to.flight));
      if (!inOrder) {
        errors.push({
          field: 'newFlightId',
          messages: [
            segmentIndex === 0
              ? OUTBOUND_AFTER_RETURN_MESSAGE
              : RETURN_TOO_EARLY_MESSAGE,
          ],
        });
      }
    }
    if (errors.length > 0) {
      throw badRequest(errors);
    }
    if (
      !ageGroupsUnchanged(booking, segmentIndex, to.flight.departureDateLocal)
    ) {
      throw new ConflictException(CHANGE_AGE_GROUP_MESSAGE);
    }
    const rule = baggageRuleOf(to);
    if (!bagsFitRule(booking, segmentIndex, rule)) {
      throw new ConflictException(CHANGE_BAGS_MESSAGE);
    }

    const policy = to.airline.policy;
    const newSegment: BookingSegment = {
      flightId: to.flight._id,
      airlineId: to.flight.airlineId,
      cabin: segment.cabin,
      fare: to.cabin.price,
      seatsReserved: segment.seatsReserved,
      cancellationTiers: (policy?.cancellationTiers ?? []).map(
        ({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }),
      ),
      extraBagPrice: policy?.extraBagPrice,
      maxExtraBags: policy?.maxExtraBags ?? 0,
      freeBags: to.cabin.freeBags,
      maxBagKg: to.cabin.maxBagKg,
    };
    const before = segmentPriceOf(booking, segment, segmentIndex);
    const after = segmentPriceOf(booking, newSegment, segmentIndex);
    const newFareTotal = booking.fareTotal - before.fareTotal + after.fareTotal;
    const newBaggageTotal =
      (booking.baggageTotal ?? 0) - before.baggageTotal + after.baggageTotal;

    const [fromFlight, toFlight] = await this.flightResponses.toResponses(
      [from, to.flight],
      now,
    );
    return {
      booking,
      bookingId: booking._id.toString(),
      segmentIndex,
      cabin: segment.cabin,
      seats: segment.seatsReserved,
      fromFlightId: segment.flightId,
      toFlightId: to.flight._id,
      fromFlight,
      toFlight,
      oldSegmentTotal: before.total,
      newSegmentTotal: after.total,
      difference: after.total - before.total,
      newFareTotal,
      newBaggageTotal,
      newTotal: newFareTotal + newBaggageTotal,
      currency: booking.currency,
      newSegment,
      toDepartureDateLocal: to.flight.departureDateLocal,
      toMaxBagKg: to.cabin.maxBagKg,
    };
  }

  /**
   * Applies an `applying` change, step by step; a step that already happened
   * is not repeated, so the job and a repeated webhook can call it again. A
   * step that fails gives its claim back and leaves the change `applying`
   * (`unfinished`): the job does it again.
   *
   * 0. A change that never held seats, or whose new flight the airline
   *    cancelled before its seats were booked (FLT-06), is abandoned.
   * 1. The new flight's held seats become booked (claimed by `seatsBookedAt`).
   * 2. One conditional update swaps the segment and the totals of the booking
   *    while it is confirmed, still on the old flight and still at the total
   *    the change was planned on. When it matches nothing and the booking is
   *    not already on the new flight (cancelled, completed or changed in
   *    between), the change is abandoned: `expired`, and the new seats are
   *    given back.
   * 3. The old flight's booked seats are given back (`oldSeatsReleasedAt`)
   *    and the seats chosen on that segment are freed (`chosenSeatsFreedAt`).
   * 4. A cheaper flight's difference is refunded from the booking's flight
   *    payment (PAY-03, `fare_difference`, idempotent per change). If the
   *    refund cannot be made yet (another refund of the payment at the same
   *    moment, the database), the change stays `applying`; a refund that can
   *    never succeed (more than the payment holds, no payment) is logged.
   * 5. `completed`, then the owner is notified, and a dearer change whose
   *    booking was cancelled meanwhile refunds its own payment.
   */
  async apply(change: FlightChangeSource, now: Date): Promise<ApplyResult> {
    const id = change._id.toString();

    // Nothing was held (a crash between the record and the hold): there are
    // no seats to book, so the change never happened.
    if (!change.heldAt) {
      await this.abandon(change, now);
      return 'abandoned';
    }
    // FLT-06: the airline cancelled the new flight after the hold. The
    // booking must never move onto it; a paid difference is refunded in full.
    if (!change.seatsBookedAt) {
      const to = await this.flights
        .findById(change.toFlightId)
        .select('status')
        .lean()
        .exec();
      if (!to || to.status === FlightStatus.Cancelled) {
        await this.abandon(change, now);
        return 'abandoned';
      }
    }

    const booked = await this.runStep(change, 'seatsBookedAt', now, () =>
      this.seatHolds.confirm(change.toFlightId, change.cabin, change.seats),
    );
    if (!booked) {
      return 'unfinished';
    }

    const path = `segments.${change.segmentIndex}`;
    const { matchedCount } = await this.bookings
      .updateOne(
        {
          _id: change.bookingId,
          status: FlightBookingStatus.Confirmed,
          [`${path}.flightId`]: change.fromFlightId,
          // Another change of the other segment completed since this one was
          // planned: these totals would undo its difference.
          total: change.totalBefore,
        },
        {
          $set: {
            [path]: change.newSegment,
            fareTotal: change.newFareTotal,
            baggageTotal: change.newBaggageTotal,
            total: change.newTotal,
          },
        },
      )
      .exec();
    if (matchedCount === 0) {
      const booking = await this.bookings
        .findById(change.bookingId)
        .select('segments')
        .lean()
        .exec();
      const onNewFlight =
        booking?.segments[change.segmentIndex]?.flightId.equals(
          change.toFlightId,
        ) === true;
      if (!onNewFlight) {
        await this.abandon(change, now);
        return 'abandoned';
      }
    }

    const released = await this.runStep(change, 'oldSeatsReleasedAt', now, () =>
      this.seatHolds.unbook(change.fromFlightId, change.cabin, change.seats),
    );
    const freed = await this.runStep(change, 'chosenSeatsFreedAt', now, () =>
      this.seatAssignments.releaseSegment(
        change.bookingId,
        change.segmentIndex,
      ),
    );
    if (!released || !freed) {
      return 'unfinished';
    }

    if (change.difference < 0) {
      try {
        await this.refunds.refundAmount({
          bookingType: BookingType.FlightChange,
          bookingId: id,
          paymentOf: {
            bookingType: BookingType.Flight,
            bookingId: change.bookingId.toString(),
          },
          amount: -change.difference,
          reason: RefundReason.FareDifference,
          link: {
            bookingType: BookingType.Flight,
            bookingId: change.bookingId.toString(),
          },
        });
      } catch (error) {
        if (!isFinalRefundFailure(error)) {
          this.logFailure(
            id,
            'the refund of the difference; the job tries again',
            error,
          );
          return 'unfinished';
        }
        // More than the payment holds, or no payment at all: it can never
        // succeed automatically.
        this.logFailure(
          id,
          'the refund of the difference; check it by hand',
          error,
        );
      }
    }

    const completed = await this.changes
      .findOneAndUpdate(
        { _id: change._id, status: FlightChangeStatus.Applying },
        {
          $set: {
            status: FlightChangeStatus.Completed,
            open: false,
            completedAt: now,
          },
        },
        { returnDocument: 'after' },
      )
      .lean<FlightChangeSource>()
      .exec();
    if (completed) {
      await this.notifyOwner(completed);
      await this.refundIfCancelledMeanwhile(completed);
    }
    return 'completed';
  }

  /**
   * A dearer change paid and swapped while its booking was being cancelled:
   * the cancellation refunded only the changes already completed, so this
   * one's payment is refunded here at the booking's refund percent (100% when
   * the airline cancelled it). Idempotent per change; a failure is logged.
   */
  private async refundIfCancelledMeanwhile(
    change: FlightChangeSource,
  ): Promise<void> {
    if (change.difference <= 0) {
      return;
    }
    const booking = await this.bookings
      .findById(change.bookingId)
      .select('status refundPercent cancelledBy')
      .lean()
      .exec();
    if (
      booking?.status !== FlightBookingStatus.Cancelled ||
      !booking.refundPercent
    ) {
      return;
    }
    await this.refunds
      .refund({
        bookingType: BookingType.FlightChange,
        bookingId: change._id.toString(),
        refundPercent: booking.refundPercent,
        reason:
          booking.cancelledBy === CancelledBy.Provider
            ? RefundReason.FlightCancelled
            : RefundReason.UserCancellation,
      })
      .catch((error: unknown) =>
        this.logFailure(
          change._id.toString(),
          'the refund of its payment after its booking was cancelled',
          error,
        ),
      );
  }

  /**
   * The flight change port's `confirmPaid` (PAY-01): the payment of a dearer
   * flight succeeded. The change is claimed from `pending_payment` to
   * `applying` only while its hold is live, then applied. `true` once the
   * booking flies the new flight (now or before); `false` when the hold had
   * ended or the booking was cancelled or changed first: the payment is then
   * refunded in full by the webhook (PAY-03).
   */
  async confirmPaid(changeId: string, now: Date): Promise<boolean> {
    if (!Types.ObjectId.isValid(changeId)) {
      return false;
    }
    let change = await this.changes
      .findOneAndUpdate(
        {
          _id: changeId,
          status: FlightChangeStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
        },
        { $set: { status: FlightChangeStatus.Applying, paidAt: now } },
        { returnDocument: 'after' },
      )
      .lean<FlightChangeSource>()
      .exec();
    if (!change) {
      change = await this.changes
        .findById(changeId)
        .lean<FlightChangeSource>()
        .exec();
      if (!change || !change.paidAt) {
        return false;
      }
      if (change.status === FlightChangeStatus.Completed) {
        return true;
      }
      if (change.status !== FlightChangeStatus.Applying) {
        return false;
      }
    }
    const result = await this.apply(change, now);
    return result !== 'abandoned';
  }

  /** The change job, part 1: dearer changes whose hold ended unpaid become `expired`. */
  async expireDueHolds(now: Date): Promise<number> {
    const due = await this.changes
      .find({
        status: FlightChangeStatus.PendingPayment,
        holdExpiresAt: { $lte: now },
      })
      .sort({ holdExpiresAt: 1 })
      .limit(FLIGHT_CHANGE_JOB_BATCH_SIZE)
      .lean<FlightChangeSource[]>()
      .exec();
    let expired = 0;
    for (const change of due) {
      expired += await this.expireIfPending(change, now, {
        holdExpiresAt: { $lte: now },
      });
    }
    return expired;
  }

  /**
   * The change job, part 2: changes left `applying` (a crash, a refund that
   * could not be made) are applied again. A paid change abandoned here is
   * refunded in full, as the webhook would.
   */
  async finishStuck(now: Date): Promise<number> {
    const stuck = await this.changes
      .find({
        status: FlightChangeStatus.Applying,
        updatedAt: {
          $lte: new Date(now.getTime() - FLIGHT_CHANGE_STUCK_AFTER_MS),
        },
      })
      .sort({ updatedAt: 1 })
      .limit(FLIGHT_CHANGE_JOB_BATCH_SIZE)
      .lean<FlightChangeSource[]>()
      .exec();
    let finished = 0;
    for (const change of stuck) {
      try {
        const result = await this.apply(change, now);
        if (result === 'abandoned' && change.paidAt) {
          await this.refunds.refund({
            bookingType: BookingType.FlightChange,
            bookingId: change._id.toString(),
            refundPercent: 100,
            reason: RefundReason.LatePayment,
          });
        }
        if (result !== 'unfinished') finished += 1;
      } catch (error) {
        this.logFailure(change._id.toString(), 'finishing it', error);
      }
    }
    return finished;
  }

  /**
   * FLT-26 and FLT-06: the booking was cancelled, so its change that waits
   * for payment expires and its held seats go back. A payment that still
   * arrives is refunded in full (`confirmPaid` answers false). A change
   * already `applying` abandons itself when it sees the booking cancelled.
   */
  async closeOpenChangeOf(bookingId: Types.ObjectId, now: Date): Promise<void> {
    const pending = await this.changes
      .findOne({ bookingId, status: FlightChangeStatus.PendingPayment })
      .lean<FlightChangeSource>()
      .exec();
    if (pending) {
      await this.expireIfPending(pending, now);
    }
  }

  /**
   * FLT-06: the airline cancelled a flight, so the changes waiting for payment
   * to that flight expire and their held seats go back.
   */
  async closePendingChangesTo(
    flightId: Types.ObjectId,
    now: Date,
  ): Promise<number> {
    const pending = await this.changes
      .find({ toFlightId: flightId, status: FlightChangeStatus.PendingPayment })
      .limit(FLIGHT_CHANGE_JOB_BATCH_SIZE)
      .lean<FlightChangeSource[]>()
      .exec();
    let closed = 0;
    for (const change of pending) {
      closed += await this.expireIfPending(change, now);
    }
    return closed;
  }

  /**
   * FLT-26 and FLT-06: the completed changes to a dearer flight, each paid by
   * its own payment (keyed on the change), which a cancellation refunds too.
   */
  async paidDifferencesOf(
    bookingId: Types.ObjectId,
  ): Promise<{ id: string; difference: number }[]> {
    const paid = await this.changes
      .find({
        bookingId,
        status: FlightChangeStatus.Completed,
        difference: { $gt: 0 },
      })
      .select('difference')
      .lean()
      .exec();
    return paid.map((change) => ({
      id: change._id.toString(),
      difference: change.difference,
    }));
  }

  /** FLT-25: a booking's changes, newest first, each with its refund. */
  async summariesOf(
    bookingId: Types.ObjectId,
  ): Promise<FlightChangeSummaryDto[]> {
    const found = await this.changes
      .find({ bookingId })
      .sort({ createdAt: -1, _id: -1 })
      .lean<FlightChangeSource[]>()
      .exec();
    return Promise.all(
      found.map(async (change) => {
        const refund: RefundSummaryDto | null =
          change.difference < 0
            ? await this.refunds.findSummaryByBooking(
                BookingType.FlightChange,
                change._id.toString(),
              )
            : null;
        return toFlightChangeSummary(change, refund);
      }),
    );
  }

  /** FLT-25: the changes of a page of bookings in one query, by booking id, without refunds. */
  async summariesOfMany(
    bookingIds: readonly Types.ObjectId[],
  ): Promise<Map<string, FlightChangeSummaryDto[]>> {
    const byBooking = new Map<string, FlightChangeSummaryDto[]>();
    if (bookingIds.length === 0) {
      return byBooking;
    }
    const found = await this.changes
      .find({ bookingId: { $in: [...bookingIds] } })
      .sort({ createdAt: -1, _id: -1 })
      .lean<FlightChangeSource[]>()
      .exec();
    for (const change of found) {
      const key = change.bookingId.toString();
      byBooking.set(key, [
        ...(byBooking.get(key) ?? []),
        toFlightChangeSummary(change),
      ]);
    }
    return byBooking;
  }

  /** The owner's change, for the payment port (404 for any other, ACC-11). */
  findOwned(
    changeId: string,
    userId: string,
  ): Promise<FlightChangeSource | null> {
    if (!Types.ObjectId.isValid(changeId)) {
      return Promise.resolve(null);
    }
    return this.changes
      .findOne({ _id: changeId, userId: new Types.ObjectId(userId) })
      .lean<FlightChangeSource>()
      .exec();
  }

  /** The booking of a change, for the payment port's links. */
  async bookingOf(changeId: string): Promise<Types.ObjectId | null> {
    if (!Types.ObjectId.isValid(changeId)) {
      return null;
    }
    const change = await this.changes
      .findById(changeId)
      .select('bookingId')
      .lean()
      .exec();
    return change?.bookingId ?? null;
  }

  /**
   * `pending_payment` -> `expired`, with one conditional update, then its held
   * seats go back. Returns 1 if this call expired it.
   */
  private async expireIfPending(
    change: FlightChangeSource,
    now: Date,
    extra: Record<string, unknown> = {},
  ): Promise<number> {
    const { matchedCount } = await this.changes
      .updateOne(
        {
          _id: change._id,
          status: FlightChangeStatus.PendingPayment,
          ...extra,
        },
        {
          $set: {
            status: FlightChangeStatus.Expired,
            open: false,
            expiredAt: now,
          },
        },
      )
      .exec();
    if (matchedCount === 0) {
      return 0;
    }
    if (change.heldAt) {
      await this.releaseHeld(change, 'it expired');
    }
    return 1;
  }

  /** `applying` -> `expired`: the booking was cancelled or changed first. */
  private async abandon(change: FlightChangeSource, now: Date): Promise<void> {
    const { matchedCount } = await this.changes
      .updateOne(
        { _id: change._id, status: FlightChangeStatus.Applying },
        {
          $set: {
            status: FlightChangeStatus.Expired,
            open: false,
            expiredAt: now,
          },
        },
      )
      .exec();
    if (matchedCount === 0) {
      return;
    }
    const current = await this.changes
      .findById(change._id)
      .select('heldAt seatsBookedAt')
      .lean()
      .exec();
    const id = change._id.toString();
    if (current?.seatsBookedAt) {
      await this.seatHolds
        .unbook(change.toFlightId, change.cabin, change.seats)
        .catch((error: unknown) =>
          this.logFailure(id, 'giving back its new seats', error),
        );
    } else if (current?.heldAt) {
      await this.releaseHeld(change, 'it was abandoned');
    }
  }

  /** Gives back the held seats of the new flight; a failure is logged. */
  private async releaseHeld(
    change: FlightChangeSource,
    why: string,
  ): Promise<void> {
    await this.seatHolds
      .release(change.toFlightId, change.cabin, change.seats)
      .catch((error: unknown) =>
        this.logFailure(
          change._id.toString(),
          `releasing its held seats (${why})`,
          error,
        ),
      );
  }

  /** A change that failed before it was held: closed, so the booking can be changed again. */
  private async markExpired(
    changeId: Types.ObjectId,
    now: Date,
  ): Promise<void> {
    await this.changes
      .updateOne(
        { _id: changeId, open: true },
        {
          $set: {
            status: FlightChangeStatus.Expired,
            open: false,
            expiredAt: now,
          },
        },
      )
      .exec()
      .catch((error: unknown) =>
        this.logFailure(changeId.toString(), 'closing it', error),
      );
  }

  /**
   * One step of `apply`, done once: it is claimed on the change first, so a
   * repeated call skips it. If the step fails, the claim is given back and
   * `false` is answered: the change stays `applying` and the job does the
   * step again.
   */
  private async runStep(
    change: FlightChangeSource,
    step: 'seatsBookedAt' | 'oldSeatsReleasedAt' | 'chosenSeatsFreedAt',
    now: Date,
    work: () => Promise<unknown>,
  ): Promise<boolean> {
    const { matchedCount } = await this.changes
      .updateOne(
        { _id: change._id, [step]: { $exists: false } },
        { $set: { [step]: now } },
      )
      .exec();
    if (matchedCount === 0) {
      return true;
    }
    try {
      await work();
      return true;
    } catch (error) {
      this.logFailure(
        change._id.toString(),
        `${step}; the job tries again`,
        error,
      );
      await this.changes
        .updateOne({ _id: change._id }, { $unset: { [step]: 1 } })
        .exec();
      return false;
    }
  }

  /** The in-app notification of an applied change (GEN-01); never throws. */
  private async notifyOwner(change: FlightChangeSource): Promise<void> {
    try {
      const [booking, flight] = await Promise.all([
        this.bookings
          .findById(change.bookingId)
          .select('reference')
          .lean()
          .exec(),
        this.flights
          .findById(change.toFlightId)
          .select('flightNumber departureAirport arrivalAirport departureAt')
          .lean()
          .exec(),
      ]);
      if (!flight) {
        throw new Error(`Flight ${change.toFlightId.toString()} is missing`);
      }
      const zones = await this.flightResponses.timeZonesOf([
        flight.departureAirport,
      ]);
      const zone = zones.get(flight.departureAirport);
      if (!zone) {
        throw new Error(`The zone of ${flight.departureAirport} is missing`);
      }
      await this.notifications.notify(
        change.userId,
        NotificationType.FlightChanged,
        bookingChangedMessage(
          booking?.reference ?? '',
          change.segmentIndex,
          {
            flightNumber: flight.flightNumber,
            departureAirport: flight.departureAirport,
            arrivalAirport: flight.arrivalAirport,
            departureLocal: toLocalTime(flight.departureAt, zone).local,
            cabin: change.cabin,
            seats: change.seats,
          },
          change.difference,
          change.currency,
        ),
        { type: NotificationLinkType.FlightBooking, id: change.bookingId },
      );
    } catch (error) {
      this.logFailure(change._id.toString(), 'its notification', error);
    }
  }

  private logFailure(changeId: string, what: string, error: unknown): void {
    this.logger.error(
      `Flight change ${changeId}: ${what} failed`,
      error instanceof Error ? error.stack : error,
    );
  }
}
