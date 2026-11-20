import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { refundPercentFor } from '../common/cancellation-tiers';
import { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { Flight } from '../flights/models/flight.schema';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundReason } from '../payments/refunds/enums/refund-reason.enum';
import { RefundsService } from '../payments/refunds/refunds.service';
import { refundTiersOf } from './booking-refund';
import type {
  FlightBookingCancellationPreviewDto,
  FlightBookingCancellationResponseDto,
} from './dto/flight-booking-cancellation-response.dto';
import { CancelledBy } from './enums/cancelled-by.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import {
  DEPARTED_MESSAGE,
  FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE,
  NOT_CANCELLABLE_MESSAGE,
  REFUND_CHANGED_MESSAGE,
} from './flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import { FlightSeatsService } from './flight-seats.service';
import type { FlightBookingSource } from './mappers/flight-booking.mapper';
import { FlightBooking } from './models/flight-booking.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * FLT-26: a registered user cancels their own confirmed flight booking any
 * time before departure, after viewing the refund and confirming it. The
 * booking becomes `cancelled` (GEN-11: Confirmed -> Cancelled), its seats go
 * back to the inventory and the refund is created through Stripe (PAY-03).
 * A round trip is cancelled as a whole with the outbound tiers (FLT-12).
 */
@Injectable()
export class FlightBookingCancellationService {
  private readonly logger = new Logger(FlightBookingCancellationService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    // Read only: the departure time of the first flight.
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly seatHolds: FlightSeatHoldsService,
    private readonly refunds: RefundsService,
    private readonly seatAssignments: FlightSeatsService,
  ) {}

  /**
   * The refund the user would get now. Changes nothing. 404 for a booking
   * that does not exist or is someone else's (ACC-11), 409 for a booking
   * that is not confirmed or whose first flight has departed.
   */
  async preview(
    id: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<FlightBookingCancellationPreviewDto> {
    const booking = await this.findOwnedOrThrow(id, userId);
    return this.quote(booking, now);
  }

  /**
   * Cancels the booking if the refund is still `expectedRefundPercent` (the
   * one the user confirmed; 409 otherwise). One conditional update moves it
   * from `confirmed` to `cancelled`, so a second cancellation, or the
   * completion job, at the same moment never cancels it twice. Then the
   * booked seats of every segment go back, the chosen seats are freed
   * (FLT-28) and the refund is created. A failure after the cancellation is
   * saved is logged, never thrown: the booking stays cancelled, the seat counters can be recomputed from the
   * bookings and a refund that was not sent is retried by PAY-03.
   */
  async cancel(
    id: string,
    userId: string,
    expectedRefundPercent: number,
    now: Date = new Date(),
  ): Promise<FlightBookingCancellationResponseDto> {
    const booking = await this.findOwnedOrThrow(id, userId);
    const quote = await this.quote(booking, now);
    if (quote.refundPercent !== expectedRefundPercent) {
      throw new ConflictException(REFUND_CHANGED_MESSAGE);
    }

    const { matchedCount } = await this.bookings
      .updateOne(
        {
          _id: booking._id,
          userId: booking.userId,
          status: FlightBookingStatus.Confirmed,
        },
        {
          $set: {
            status: FlightBookingStatus.Cancelled,
            cancelledAt: now,
            cancelledBy: CancelledBy.User,
            refundPercent: quote.refundPercent,
          },
        },
      )
      .exec();
    if (matchedCount === 0) {
      // Cancelled or completed in between.
      throw new ConflictException(NOT_CANCELLABLE_MESSAGE);
    }

    for (const segment of booking.segments) {
      await this.seatHolds
        .unbook(segment.flightId, segment.cabin, segment.seatsReserved)
        .catch((error: unknown) =>
          this.logger.error(
            `Booking ${quote.bookingId} is cancelled, but its ${segment.seatsReserved} seat(s) on flight ${segment.flightId.toString()} were not given back`,
            error instanceof Error ? error.stack : error,
          ),
        );
    }
    // FLT-28: the chosen seats are free again for other users.
    await this.seatAssignments
      .releaseBooking(booking._id)
      .catch((error: unknown) =>
        this.logger.error(
          `Booking ${quote.bookingId} is cancelled, but its chosen seats were not freed`,
          error instanceof Error ? error.stack : error,
        ),
      );

    let refund: FlightBookingCancellationResponseDto['refund'] = null;
    try {
      const created = await this.refunds.refund({
        bookingType: BookingType.Flight,
        bookingId: quote.bookingId,
        refundPercent: quote.refundPercent,
        reason: RefundReason.UserCancellation,
      });
      refund = created && {
        id: created.id,
        status: created.status,
        amount: created.amount,
        currency: created.currency,
        refundPercent: created.refundPercent,
      };
    } catch (error) {
      this.logger.error(
        `Booking ${quote.bookingId} is cancelled, but its refund could not be created`,
        error instanceof Error ? error.stack : error,
      );
    }

    return {
      ...quote,
      status: FlightBookingStatus.Cancelled,
      cancelledAt: now.toISOString(),
      refund,
    };
  }

  /** The owner's booking as stored; 404 for a missing one or another user's. */
  private async findOwnedOrThrow(
    id: string,
    userId: string,
  ): Promise<FlightBookingSource> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    return booking;
  }

  /**
   * The refund at `now`: 409 unless the booking is confirmed and its first
   * flight has not departed. The tiers are those copied into the booking
   * (refundTiersOf: the outbound flight's), compared with the whole days
   * left before the departure (FLT-09, refundPercentFor).
   */
  private async quote(
    booking: FlightBookingSource,
    now: Date,
  ): Promise<FlightBookingCancellationPreviewDto> {
    if (booking.status !== FlightBookingStatus.Confirmed) {
      throw new ConflictException(NOT_CANCELLABLE_MESSAGE);
    }
    const first = await this.flights
      .findById(booking.segments[0]?.flightId)
      .select('departureAt status')
      .lean()
      .exec();
    // A flight that no longer exists cannot be checked: it counts as departed.
    if (!first || first.departureAt.getTime() <= now.getTime()) {
      throw new ConflictException(DEPARTED_MESSAGE);
    }
    // FLT-06: the airline's cancellation cancels it with a full refund.
    if (first.status === FlightStatus.Cancelled) {
      throw new ConflictException(FLIGHT_CANCELLED_BY_AIRLINE_MESSAGE);
    }
    const daysRemaining = Math.floor(
      (first.departureAt.getTime() - now.getTime()) / DAY_MS,
    );
    const refundPercent = refundPercentFor(
      refundTiersOf(booking),
      daysRemaining,
    );
    return {
      bookingId: booking._id.toString(),
      departureAt: first.departureAt.toISOString(),
      daysRemaining,
      refundPercent,
      total: booking.total,
      refundAmount: Math.round((booking.total * refundPercent) / 100),
      currency: booking.currency,
    };
  }
}
