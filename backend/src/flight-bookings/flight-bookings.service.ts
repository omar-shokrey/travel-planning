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
import type { FieldError } from '../common/interfaces/error-response.interface';
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
import type { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { Flight } from '../flights/models/flight.schema';
import {
  type BaggageRule,
  type PassengerPlan,
  type PlannedPassenger,
  type PlannedReturnPassenger,
  planPassengers,
  planReturnPassengers,
  returnBagsWithoutReturnFlight,
} from './booking-passengers';
import { priceBooking } from './booking-price';
import type { FlightBookingResponseDto } from './dto/flight-booking-response.dto';
import type { FlightBookingSummaryResponseDto } from './dto/flight-booking-summary-response.dto';
import type { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import {
  FLIGHT_BOOKING_HOLD_MINUTES,
  FLIGHT_CHANGED_MESSAGE,
  RETURN_TOO_EARLY_MESSAGE,
  returnFlightMessage,
  returnRouteMessage,
} from './flight-bookings.constants';
import { passengerTypeOn } from './passenger-types';
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
 * and the times are there too. They are read as optional: if one were ever
 * missing, the booking treats the flight as changed and releases the seats.
 */
type HeldFlightWithTimes = HeldFlight &
  Partial<Pick<Flight, 'departureDateLocal' | 'departureAt' | 'arrivalAt'>>;

/**
 * FLT-19 and FLT-21: one flight of a booking, read as the hold will see it,
 * with the hold's 404s and 409 in the hold's order and no 400. One light,
 * read-only read of the flight (`PLANNED_FLIGHT_FIELDS`) and one of its
 * airline.
 */
async function readFlightForBooking(
  flights: Model<Flight>,
  airlines: AirlinesService,
  flightId: string,
  cabinClass: CabinClass,
  now: Date,
) {
  const flight = await flights
    .findById(flightId)
    .select(PLANNED_FLIGHT_FIELDS)
    .lean()
    .exec();
  if (!flight) {
    throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
  }
  // The same answers as the hold, before any 400, so a flight that cannot
  // be booked never reveals its airline's bag rule (ACC-15, FLT-30). The
  // hold checks all of them again in its atomic update.
  const airline = await airlines
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
    (stored) => stored.cabin === cabinClass,
  );
  if (!cabin) {
    throw new NotFoundException(cabinNotOnFlightMessage(cabinClass));
  }
  return { flightId, flight, airline, cabin, cabinClass };
}

type FlightForBooking = Awaited<ReturnType<typeof readFlightForBooking>>;

/** One flight of a booking with what each passenger has on it. */
type PlannedLeg = FlightForBooking & {
  passengers: readonly (PlannedPassenger | PlannedReturnPassenger)[];
};

/** Everything the hold and the summary need, checked, before anything is held. */
interface PlannedBooking {
  plan: PassengerPlan;
  outbound: PlannedLeg & { passengers: PlannedPassenger[] };
  /** FLT-12(a): the return flight of a round trip; absent one-way. */
  return?: PlannedLeg & { passengers: PlannedReturnPassenger[] };
}

/** The extra-bag rule of a flight: its airline's price and maximum, its cabin's bag weight. */
const baggageRuleOf = ({ airline, cabin }: FlightForBooking): BaggageRule => ({
  extraBagPrice: airline.policy?.extraBagPrice,
  maxExtraBags: airline.policy?.maxExtraBags ?? 0,
  maxBagKg: cabin.maxBagKg,
});

/**
 * FLT-12(a): the return flight leaves after the outbound flight arrives.
 * A missing time counts as not after (the caller then refuses).
 */
export const returnLeavesAfterArrival = (
  outbound: { arrivalAt?: Date },
  back: { departureAt?: Date },
): boolean =>
  outbound.arrivalAt !== undefined &&
  back.departureAt !== undefined &&
  back.departureAt.getTime() > outbound.arrivalAt.getTime();

/**
 * FLT-12(a): a 404 or 409 about the return flight says so, so the user knows
 * which flight to change. Any other error is passed on as it is.
 */
export const forReturnFlight = (error: unknown): unknown => {
  if (error instanceof NotFoundException) {
    return new NotFoundException(returnFlightMessage(error.message));
  }
  if (error instanceof ConflictException) {
    return new ConflictException(returnFlightMessage(error.message));
  }
  return error;
};

const sumOf = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0);

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
   * passenger and their extra bags. FLT-12(a): with `returnFlightId` and
   * `returnCabin` it is a round trip, booked as one booking with two segments
   * (outbound, then return), one payment and one reference.
   *
   * 1. `planBooking` (shared with the summary, FLT-21): a light read of each
   *    flight and its airline. A missing flight or airline, a deactivated
   *    airline (ACC-15), a flight that can no longer be booked (FLT-30) and
   *    a missing cabin get the hold's 404 or 409 here, before any 400 (for
   *    the return flight prefixed "Return flight: ").
   * 2. Each passenger's type is derived from the date of birth on the
   *    outbound departure date (FLT-12(b)); the passenger rules, the round
   *    trip rules and the extra bags of each flight are checked and priced.
   *    Any problem is a 400 with the field path, and nothing is held.
   * 3. The seats (adults and children) are held with one conditional update
   *    on each flight (`FlightSeatHoldsService.hold`), outbound first. If the
   *    return hold is refused, the outbound seats are released.
   * 4. Each flight the hold returned must still have the departure date and
   *    the bag weight of step 1, and the return must still leave after the
   *    outbound arrives: a flight edited in between (FLT-05, FLT-04) gives
   *    409 and every seat is released.
   * 5. The fare of each segment is the cabin price of the flight its hold
   *    returned. The booking is saved as `pending_payment` with a hold of 10
   *    minutes.
   *
   * Every error after a hold releases the seats held so far before it is
   * rethrown, so nothing stays held for a booking that does not exist.
   *
   * PAY-02: each airline's cancellation tiers and extra-bag rule and each
   * cabin's free allowance are copied into its segment, so the policy the user
   * is shown and accepts is the one a refund and the bags use. A round trip is
   * refunded with the outbound segment's tiers (`refundTiersOf`).
   */
  async hold(
    userId: string,
    dto: HoldFlightBookingDto,
  ): Promise<FlightBookingResponseDto> {
    const now = new Date();
    const holdExpiresAt = new Date(
      now.getTime() + FLIGHT_BOOKING_HOLD_MINUTES * 60 * 1000,
    );

    const planned = await this.planBooking(dto, now);
    const { plan } = planned;
    const seats = plan.seats;
    const legs: PlannedLeg[] = [
      planned.outbound,
      ...(planned.return ? [planned.return] : []),
    ];

    // Every leg held so far, released if anything fails later.
    const held: { flight: HeldFlightWithTimes; leg: PlannedLeg }[] = [];
    const bookingId = new Types.ObjectId();
    let booking;
    try {
      for (const [index, leg] of legs.entries()) {
        const flight: HeldFlightWithTimes = await this.seatHolds
          .hold(leg.flightId, leg.cabinClass, seats, now)
          .catch((error: unknown) => {
            throw index === 0 ? error : forReturnFlight(error);
          });
        held.push({ flight, leg });
      }

      const segments = held.map(({ flight, leg }) => {
        const cabin = flight.cabins.find(
          (stored) => stored.cabin === leg.cabinClass,
        );
        if (!cabin) {
          // The update matched this cabin, so it is in the returned flight.
          throw new Error(
            `Flight ${flight._id.toString()} returned no ${leg.cabinClass} cabin after the hold`,
          );
        }
        // The types, the bag weight and the order of the two flights were
        // checked against the flights as they were before the hold. If one
        // changed in between, start again.
        if (
          flight.departureDateLocal !== leg.flight.departureDateLocal ||
          cabin.maxBagKg !== leg.cabin.maxBagKg
        ) {
          throw new ConflictException(FLIGHT_CHANGED_MESSAGE);
        }
        return { flight, leg, cabin };
      });
      if (
        segments.length === 2 &&
        !returnLeavesAfterArrival(segments[0].flight, segments[1].flight)
      ) {
        throw new ConflictException(FLIGHT_CHANGED_MESSAGE);
      }

      // FLT-21: the same price function as the summary, with the fare of each
      // flight its hold returned.
      const prices = segments.map(({ cabin, leg }) =>
        priceBooking(cabin.price, { ...plan, passengers: leg.passengers }),
      );
      const fareTotal = sumOf(prices.map((price) => price.fareTotal));
      const baggageTotal = sumOf(prices.map((price) => price.baggageTotal));
      booking = await this.bookings.create({
        _id: bookingId,
        userId: new Types.ObjectId(userId),
        status: FlightBookingStatus.PendingPayment,
        holdExpiresAt,
        currency: PLATFORM_CURRENCY,
        fareTotal,
        baggageTotal,
        total: fareTotal + baggageTotal,
        segments: segments.map(({ flight, leg, cabin }) => {
          const policy = leg.airline.policy;
          return {
            flightId: flight._id,
            airlineId: flight.airlineId,
            cabin: leg.cabinClass,
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
          };
        }),
        passengerCounts: plan.counts,
        passengers: plan.passengers.map((passenger, index) => ({
          fullName: passenger.fullName,
          dateOfBirth: passenger.dateOfBirth,
          passportNumber: passenger.passportNumber,
          type: passenger.type,
          baggage: segments.flatMap(({ leg }, segment) => {
            const bags = leg.passengers[index].extraBags;
            return bags
              ? [{ segment, bags: bags.bags, weightKg: bags.weightKg }]
              : [];
          }),
        })),
      });
    } catch (error) {
      // Nothing may stay held for a booking that does not exist. A failed
      // release is logged (ids and counts only, never personal data): the
      // first error is the one the caller must see.
      for (const { flight, leg } of held) {
        await this.seatHolds
          .release(flight._id, leg.cabinClass, seats)
          .catch((releaseError: unknown) =>
            this.logger.error(
              `Booking ${bookingId.toString()} was not saved and its ${seats} seat(s) on flight ${flight._id.toString()} could not be released`,
              releaseError instanceof Error ? releaseError.stack : releaseError,
            ),
          );
      }
      throw error;
    }
    return toFlightBookingResponse(booking.toObject());
  }

  /**
   * FLT-21: the booking summary (flight, passengers, baggage, total) before
   * payment. The same body, the same checks in the same order
   * (`planBooking`) and the same price function (`priceBooking`) as the
   * hold, so both give the same totals for the same passengers and the same
   * cabin prices. It holds nothing and saves nothing. FLT-12(a): a round trip
   * shows the return flight too (`returnTrip`), and the totals cover both.
   *
   * The seat check here only informs: 409 "Not enough seats left in this
   * cabin" when a cabin already has too few. The hold checks again
   * atomically, and the seats or the price can still change before it.
   */
  async summarise(
    dto: HoldFlightBookingDto,
  ): Promise<FlightBookingSummaryResponseDto> {
    const now = new Date();
    const { outbound, return: back, plan } = await this.planBooking(dto, now);
    for (const [leg, wrap] of [
      [outbound, (message: string) => message],
      ...(back ? [[back, returnFlightMessage] as const] : []),
    ] as const) {
      const seatsLeft =
        leg.cabin.totalSeats - leg.cabin.bookedSeats - leg.cabin.heldSeats;
      if (seatsLeft < plan.seats) {
        throw new ConflictException(wrap(NOT_ENOUGH_SEATS_MESSAGE));
      }
    }
    const legOf = async (leg: PlannedLeg) => ({
      flight: await this.flightResponses.toResponse(leg.flight, now),
      airline: leg.airline,
      cabin: leg.cabin,
      passengers: leg.passengers,
      price: priceBooking(leg.cabin.price, {
        ...plan,
        passengers: leg.passengers,
      }),
    });
    return toFlightBookingSummary({
      ...(await legOf(outbound)),
      plan,
      returnTrip: back ? await legOf(back) : null,
    });
  }

  /**
   * FLT-21: the checks the hold and the summary share, at one `now`, before
   * anything is held. Writes nothing.
   *
   * For the outbound flight, then (FLT-12(a)) the return flight, in this
   * order: one light read of the flight and one of its airline; 404 "Flight
   * not found" (missing flight or airline, or a deactivated airline, ACC-15),
   * 409 "This flight can no longer be booked" (FLT-30), 404 for a missing
   * cabin; the return flight's answers start with "Return flight: ". All of
   * them come before any 400.
   *
   * Then every 400 in one answer: the return flight must fly the outbound
   * route reversed and leave after the outbound flight arrives (on
   * `returnFlightId`); the passengers are typed on the outbound date, checked
   * and their bags priced (`planPassengers`); on a round trip the return
   * flight's bags are checked and priced and no infant may be 2 or older on
   * the return date (`planReturnPassengers`); on a one-way booking no
   * passenger may send `returnExtraBags`.
   */
  private async planBooking(
    dto: HoldFlightBookingDto,
    now: Date,
  ): Promise<PlannedBooking> {
    const read = (flightId: string, cabinClass: CabinClass) =>
      readFlightForBooking(
        this.flights,
        this.airlines,
        flightId,
        cabinClass,
        now,
      );
    const outbound = await read(dto.flightId, dto.cabin);
    const back =
      dto.returnFlightId != null && dto.returnCabin != null
        ? await read(dto.returnFlightId, dto.returnCabin).catch(
            (error: unknown) => {
              throw forReturnFlight(error);
            },
          )
        : undefined;

    const errors: FieldError[] = [];
    if (back) {
      const from = outbound.flight;
      const to = back.flight;
      if (
        to.departureAirport !== from.arrivalAirport ||
        to.arrivalAirport !== from.departureAirport
      ) {
        errors.push({
          field: 'returnFlightId',
          messages: [
            returnRouteMessage(from.departureAirport, from.arrivalAirport),
          ],
        });
      } else if (!returnLeavesAfterArrival(from, to)) {
        errors.push({
          field: 'returnFlightId',
          messages: [RETURN_TOO_EARLY_MESSAGE],
        });
      }
    }

    const outboundPlan = planPassengers(
      dto.passengers,
      outbound.flight.departureDateLocal,
      baggageRuleOf(outbound),
    );
    errors.push(...outboundPlan.errors);
    const types = dto.passengers.map((passenger) =>
      passengerTypeOn(
        passenger.dateOfBirth,
        outbound.flight.departureDateLocal,
      ),
    );
    const returnPlan = back
      ? planReturnPassengers(
          dto.passengers,
          types,
          back.flight.departureDateLocal,
          baggageRuleOf(back),
        )
      : undefined;
    if (returnPlan) {
      errors.push(...returnPlan.errors);
    } else {
      errors.push(...returnBagsWithoutReturnFlight(dto.passengers));
    }

    if (errors.length > 0 || !outboundPlan.plan) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    const plan = outboundPlan.plan;
    return {
      plan,
      outbound: { ...outbound, passengers: plan.passengers },
      ...(back && returnPlan?.passengers
        ? { return: { ...back, passengers: returnPlan.passengers } }
        : {}),
    };
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
