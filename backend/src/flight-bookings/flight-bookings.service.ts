import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { AirlinesService } from '../flights/airlines.service';
import { FlightSeatHoldsService } from '../flights/flight-seat-holds.service';
import type { FlightBookingResponseDto } from './dto/flight-booking-response.dto';
import type { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import {
  FLIGHT_BOOKING_HOLD_MINUTES,
  INFANT_FARE_PERCENT,
} from './flight-bookings.constants';
import { toFlightBookingResponse } from './mappers/flight-booking.mapper';
import { FlightBooking } from './models/flight-booking.schema';

/** FLT-12: an infant pays 10% of the fare, rounded to a whole minor unit. */
export const infantFareOf = (fare: number): number =>
  Math.round((fare * INFANT_FARE_PERCENT) / 100);

/** Every seat at the full fare, every infant at the infant fare: whole minor units. */
export const fareTotalOf = (
  fare: number,
  seats: number,
  infants: number,
): number => fare * seats + infants * infantFareOf(fare);

/** FLT-22: flight bookings. */
@Injectable()
export class FlightBookingsService {
  private readonly logger = new Logger(FlightBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly seatHolds: FlightSeatHoldsService,
    private readonly airlines: AirlinesService,
  ) {}

  /**
   * FLT-22: the user proceeds to payment. The seats are held first, with one
   * conditional update on the flight (`FlightSeatHoldsService.hold`), then
   * the booking is saved as `pending_payment` with a hold of 10 minutes. If
   * saving fails, the seats are released before the error is rethrown, so
   * nothing stays held for a booking that does not exist.
   *
   * The fare is the cabin price of the flight document the hold returned, so
   * a price edit at the same moment cannot give a total that differs from
   * the price the seats were taken at.
   *
   * PAY-02: the airline's cancellation tiers and extra-bag rule and the
   * cabin's free allowance are copied into the segment at the same time, so
   * the policy the user is shown and accepts is the one a refund uses. The
   * airline is read inside the same try as the save: if the read fails, the
   * seats are released too.
   */
  async hold(
    userId: string,
    dto: HoldFlightBookingDto,
  ): Promise<FlightBookingResponseDto> {
    const now = new Date();
    const holdExpiresAt = new Date(
      now.getTime() + FLIGHT_BOOKING_HOLD_MINUTES * 60 * 1000,
    );
    const { adults, children, infants } = dto.passengers;
    const seats = adults + children;

    const flight = await this.seatHolds.hold(
      dto.flightId,
      dto.cabin,
      seats,
      now,
    );
    const bookingId = new Types.ObjectId();

    let booking;
    try {
      const cabin = flight.cabins.find((stored) => stored.cabin === dto.cabin);
      if (!cabin) {
        // The update matched this cabin, so it is in the returned flight.
        throw new Error(
          `Flight ${flight._id.toString()} returned no ${dto.cabin} cabin after the hold`,
        );
      }
      // PAY-02: the policy the user will accept is copied now, with the fare,
      // so a later change by the airline never changes this booking.
      const airline = await this.airlines.findEntityOrThrow(
        flight.airlineId.toString(),
      );
      const policy = airline.policy;
      const fareTotal = fareTotalOf(cabin.price, seats, infants);
      booking = await this.bookings.create({
        _id: bookingId,
        userId: new Types.ObjectId(userId),
        status: FlightBookingStatus.PendingPayment,
        holdExpiresAt,
        currency: PLATFORM_CURRENCY,
        fareTotal,
        total: fareTotal,
        segments: [
          {
            flightId: flight._id,
            airlineId: flight.airlineId,
            cabin: dto.cabin,
            fare: cabin.price,
            seatsReserved: seats,
            cancellationTiers: (policy?.cancellationTiers ?? []).map(
              ({ daysBefore, refundPercent }) => ({
                daysBefore,
                refundPercent,
              }),
            ),
            extraBagPrice: policy?.extraBagPrice,
            maxExtraBags: policy?.maxExtraBags ?? 0,
            freeBags: cabin.freeBags,
            maxBagKg: cabin.maxBagKg,
          },
        ],
        passengerCounts: { adults, children, infants },
      });
    } catch (error) {
      // Nothing may stay held for a booking that does not exist. A failed
      // release is logged: the save error is the one the caller must see.
      await this.seatHolds
        .release(flight._id, dto.cabin, seats)
        .catch((releaseError: unknown) =>
          this.logger.error(
            `Booking ${bookingId.toString()} was not saved and its ${seats} seat(s) could not be released`,
            releaseError instanceof Error ? releaseError.stack : releaseError,
          ),
        );
      throw error;
    }
    return toFlightBookingResponse(booking.toObject());
  }
}
