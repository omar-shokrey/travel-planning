import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { AirlinesService } from '../flights/airlines.service';
import {
  cabinNotOnFlightMessage,
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  FlightSeatHoldsService,
  type HeldFlight,
  NOT_ENOUGH_SEATS_MESSAGE,
} from '../flights/flight-seat-holds.service';
import { FlightResponsesService } from '../flights/flight-responses.service';
import { effectiveStatus } from '../flights/flight-status';
import { FLIGHT_NOT_FOUND_MESSAGE } from '../flights/flights.constants';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { Flight } from '../flights/models/flight.schema';
import { planPassengers } from './booking-passengers';
import { priceBooking } from './booking-price';
import type { FlightBookingResponseDto } from './dto/flight-booking-response.dto';
import type { FlightBookingSummaryResponseDto } from './dto/flight-booking-summary-response.dto';
import type { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import {
  FLIGHT_BOOKING_HOLD_MINUTES,
  FLIGHT_CHANGED_MESSAGE,
} from './flight-bookings.constants';
import {
  type FlightBookingSource,
  toFlightBookingResponse,
} from './mappers/flight-booking.mapper';
import { toFlightBookingSummary } from './mappers/flight-booking-summary.mapper';
import { FlightBooking } from './models/flight-booking.schema';

// FLT-21: the fare helpers live in booking-price.ts with the one booking
// price; they are re-exported here for the callers that import them from
// the service.
export { fareTotalOf, infantFareOf } from './booking-price';

/**
 * FLT-19 and FLT-21: the one light, read-only read of the flight before
 * anything is held. The status, departure and cabins serve the checks; the
 * number, airports, times and timestamps let the summary show the flight
 * (FlightResponsesService). Whole `cabins`, so each keeps its `_id`.
 */
const PLANNED_FLIGHT_FIELDS =
  'airlineId flightNumber departureAirport arrivalAirport departureAt arrivalAt departureDateLocal status cabins createdAt updatedAt';

/** PAY-02: a booking that does not exist or is not the caller's (ACC-11). */
export const BOOKING_NOT_FOUND_MESSAGE = 'Booking not found';

/**
 * The flight the seat hold returns. `HeldFlight` names only the fields FLT-22
 * needed; the hold returns the whole flight document, so the departure date
 * is there too. It is read as optional: if it were ever missing, the booking
 * treats the flight as changed and releases the seats.
 */
type HeldFlightWithDate = HeldFlight &
  Partial<Pick<Flight, 'departureDateLocal'>>;

/** FLT-22 and FLT-19: flight bookings. */
@Injectable()
export class FlightBookingsService {
  private readonly logger = new Logger(FlightBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    // FLT-19: one read-only, light read of the flight before the hold.
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly seatHolds: FlightSeatHoldsService,
    private readonly airlines: AirlinesService,
    // FLT-21: the flight of the summary, with its local times (GEN-06).
    private readonly flightResponses: FlightResponsesService,
  ) {}

  /**
   * FLT-22 and FLT-19: the user proceeds to payment with the details of every
   * passenger and their extra bags.
   *
   * 1. `planBooking` (shared with the summary, FLT-21): a light read of the
   *    flight and a read of the airline's extra-bag rule. A missing flight or airline, a deactivated airline (ACC-15), a
   *    flight that can no longer be booked (FLT-30) and a missing cabin get
   *    the hold's 404 or 409 here, before any 400.
   * 2. Each passenger's type is derived from the date of birth on the
   *    departure date (FLT-12(b)); the passenger rules and the extra bags are
   *    checked and priced (`planPassengers`). Any problem is a 400 with the
   *    field path, and nothing is held.
   * 3. The seats (adults and children) are held with one conditional update
   *    on the flight (`FlightSeatHoldsService.hold`).
   * 4. The flight the hold returned must still have the departure date and
   *    the bag weight of step 1: a flight edited in between (FLT-05, FLT-04)
   *    gives 409 and the seats are released.
   * 5. The fare is the cabin price of the flight the hold returned, so a
   *    price edit at the same moment cannot give a total that differs from
   *    the price the seats were taken at. The booking is saved as
   *    `pending_payment` with a hold of 10 minutes.
   *
   * Every error after step 3 releases the seats before it is rethrown, so
   * nothing stays held for a booking that does not exist.
   *
   * PAY-02: the airline's cancellation tiers and extra-bag rule and the
   * cabin's free allowance are copied into the segment, so the policy the
   * user is shown and accepts is the one a refund and the bags use.
   */
  async hold(
    userId: string,
    dto: HoldFlightBookingDto,
  ): Promise<FlightBookingResponseDto> {
    const now = new Date();
    const holdExpiresAt = new Date(
      now.getTime() + FLIGHT_BOOKING_HOLD_MINUTES * 60 * 1000,
    );

    const {
      flight: planned,
      airline,
      cabin: plannedCabin,
      plan,
    } = await this.planBooking(dto, now);
    const policy = airline.policy;
    const { seats, counts } = plan;

    const flight: HeldFlightWithDate = await this.seatHolds.hold(
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
      // The types and the bag weight were checked against the flight as it
      // was before the hold. If it changed in between, start again.
      if (
        flight.departureDateLocal !== planned.departureDateLocal ||
        cabin.maxBagKg !== plannedCabin.maxBagKg
      ) {
        throw new ConflictException(FLIGHT_CHANGED_MESSAGE);
      }

      // FLT-21: the same price function as the summary, with the fare of the
      // flight the hold returned.
      const { fareTotal, baggageTotal, total } = priceBooking(
        cabin.price,
        plan,
      );
      booking = await this.bookings.create({
        _id: bookingId,
        userId: new Types.ObjectId(userId),
        status: FlightBookingStatus.PendingPayment,
        holdExpiresAt,
        currency: PLATFORM_CURRENCY,
        fareTotal,
        baggageTotal,
        total,
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
        passengerCounts: counts,
        passengers: plan.passengers.map((passenger) => ({
          fullName: passenger.fullName,
          dateOfBirth: passenger.dateOfBirth,
          passportNumber: passenger.passportNumber,
          type: passenger.type,
          baggage: passenger.extraBags
            ? [
                {
                  segment: 0,
                  bags: passenger.extraBags.bags,
                  weightKg: passenger.extraBags.weightKg,
                },
              ]
            : [],
        })),
      });
    } catch (error) {
      // Nothing may stay held for a booking that does not exist. A failed
      // release is logged (ids and counts only, never personal data): the
      // first error is the one the caller must see.
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

  /**
   * FLT-21: the booking summary (flight, passengers, baggage, total) before
   * payment. The same body, the same checks in the same order
   * (`planBooking`) and the same price function (`priceBooking`) as the
   * hold, so both give the same totals for the same passengers and the same
   * cabin price. It holds nothing and saves nothing.
   *
   * The seat check here only informs: 409 "Not enough seats left in this
   * cabin" when the cabin already has too few. The hold checks again
   * atomically, and the seats or the price can still change before it.
   */
  async summarise(
    dto: HoldFlightBookingDto,
  ): Promise<FlightBookingSummaryResponseDto> {
    const now = new Date();
    const { flight, airline, cabin, plan } = await this.planBooking(dto, now);
    const seatsLeft = cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats;
    if (seatsLeft < plan.seats) {
      throw new ConflictException(NOT_ENOUGH_SEATS_MESSAGE);
    }
    return toFlightBookingSummary({
      flight: await this.flightResponses.toResponse(flight, now),
      airline,
      cabin,
      plan,
      price: priceBooking(cabin.price, plan),
    });
  }

  /**
   * FLT-21: the checks the hold and the summary share, at one `now`, before
   * anything is held. One light read of the flight (with what the summary
   * shows: its times, airports, number and cabins) and one read of the
   * airline, then, in this order: 404 "Flight not found" (missing flight or
   * airline, or a deactivated airline, ACC-15), 409 "This flight can no
   * longer be booked" (FLT-30), 404 for a missing cabin, all before any 400;
   * then the passengers are typed, checked and their bags priced
   * (`planPassengers`), with a 400 on the field paths. Writes nothing.
   */
  private async planBooking(dto: HoldFlightBookingDto, now: Date) {
    const flight = await this.flights
      .findById(dto.flightId)
      .select(PLANNED_FLIGHT_FIELDS)
      .lean()
      .exec();
    if (!flight) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    // The same answers as the hold, before any 400, so a flight that cannot
    // be booked never reveals its airline's bag rule (ACC-15, FLT-30). The
    // hold checks all of them again in its atomic update.
    const airline = await this.airlines
      .findEntityOrThrow(flight.airlineId.toString())
      .catch((error: unknown) => {
        throw error instanceof NotFoundException
          ? new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE)
          : error;
      });
    // An airline stored before ACC-15 has no `active` field and counts as active.
    if (airline.active === false) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    if (effectiveStatus(flight, now) !== FlightStatus.Scheduled) {
      throw new ConflictException(FLIGHT_NOT_BOOKABLE_MESSAGE);
    }
    const cabin = (flight.cabins ?? []).find(
      (stored) => stored.cabin === dto.cabin,
    );
    if (!cabin) {
      throw new NotFoundException(cabinNotOnFlightMessage(dto.cabin));
    }
    const policy = airline.policy;

    const { plan, errors } = planPassengers(
      dto.passengers,
      flight.departureDateLocal,
      {
        extraBagPrice: policy?.extraBagPrice,
        maxExtraBags: policy?.maxExtraBags ?? 0,
        maxBagKg: cabin.maxBagKg,
      },
    );
    if (!plan) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    return { flight, airline, cabin, plan };
  }

  /**
   * PAY-02: the user's own booking as stored, for the payments module (never
   * through a controller). 404 "Booking not found" when it does not exist or
   * belongs to another user, so a user never learns that someone else's
   * booking exists (ACC-11).
   */
  async findOwnedEntityOrThrow(
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
   * PAY-02: records that the user accepted the policies, with one
   * conditional update: only the user's own booking, still waiting for
   * payment, whose hold has not ended at `now` and that was not accepted
   * before, so the first timestamp is never moved. Returns the booking
   * after the change, or `null` when nothing matched (the caller reads it
   * to say why).
   */
  acceptPolicies(
    id: string,
    userId: string,
    now: Date,
  ): Promise<FlightBookingSource | null> {
    return this.bookings
      .findOneAndUpdate(
        {
          _id: id,
          userId: new Types.ObjectId(userId),
          status: FlightBookingStatus.PendingPayment,
          holdExpiresAt: { $gt: now },
          policyAcceptedAt: { $exists: false },
        },
        { $set: { policyAcceptedAt: now } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
  }
}
