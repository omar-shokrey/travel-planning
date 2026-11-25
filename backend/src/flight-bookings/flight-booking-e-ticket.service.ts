import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { AirlinesService } from '../flights/airlines.service';
import { toLocalTime } from '../flights/flight-local-time';
import { FlightResponsesService } from '../flights/flight-responses.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from '../flights/flights.constants';
import { Flight } from '../flights/models/flight.schema';
import { CABIN_LABELS } from './booking-confirmation-message';
import {
  type ETicket,
  formatMoney,
  maskPassport,
  renderETicket,
} from './e-ticket/e-ticket-pdf';
import type { FlightChangeSummaryDto } from './dto/flight-change-response.dto';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FlightChangeStatus } from './enums/flight-change-status.enum';
import { FlightChangeService } from './flight-change.service';
import { FlightSeatsService } from './flight-seats.service';
import { E_TICKET_NOT_CONFIRMED_MESSAGE } from './flight-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import { needsSeat, type SeatRecord } from './mappers/booking-seats.mapper';
import type { FlightBookingSource } from './mappers/flight-booking.mapper';
import {
  FlightBooking,
  type BookingSegment,
  type Passenger,
} from './models/flight-booking.schema';

/** The e-ticket as the controller sends it. */
export interface ETicketFile {
  filename: string;
  pdf: Buffer;
}

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

const capitalised = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

/** FLT-28: the seat of one passenger on one leg, as the e-ticket prints it. */
function seatLineOf(
  passenger: Passenger,
  passengerIndex: number,
  segmentIndex: number,
  seats: readonly SeatRecord[],
): string {
  if (!needsSeat(passenger.type)) return 'no seat (infant)';
  const seat = seats.find(
    (one) =>
      one.segmentIndex === segmentIndex &&
      one.passengerIndex === passengerIndex,
  );
  return seat ? `seat ${seat.seatNumber}` : 'seat not chosen yet';
}

/** The cabin's free allowance copied into the segment (PAY-02). A segment saved before PAY-02 has none. */
function freeBaggageOf(segment: BookingSegment): string {
  if (segment.freeBags === undefined) return 'not recorded';
  if (segment.freeBags === 0) return 'none';
  return segment.maxBagKg === undefined
    ? plural(segment.freeBags, 'bag')
    : `${plural(segment.freeBags, 'bag')} of up to ${segment.maxBagKg} kg each`;
}

function extraBaggageOf(passenger: Passenger, segmentIndex: number): string {
  const bags = (passenger.baggage ?? []).find(
    ({ segment }) => segment === segmentIndex,
  );
  return bags
    ? `${plural(bags.bags, 'extra bag')}, ${bags.weightKg} kg in total`
    : 'no extra bags';
}

/**
 * FLT-23: the downloadable e-ticket of a confirmed flight booking, as a PDF.
 * Only the owner gets it (another user's booking is 404, ACC-11), and only
 * once the booking is confirmed. The passport number is masked; nothing about
 * the passengers is logged.
 */
@Injectable()
export class FlightBookingETicketService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly airlines: AirlinesService,
    private readonly flightResponses: FlightResponsesService,
    private readonly seats: FlightSeatsService,
    // FLT-27: the flight changes the ticket lists.
    private readonly changes: FlightChangeService,
  ) {}

  async eTicket(id: string, userId: string): Promise<ETicketFile> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    if (
      booking.status !== FlightBookingStatus.Confirmed ||
      !booking.reference
    ) {
      throw new ConflictException(E_TICKET_NOT_CONFIRMED_MESSAGE);
    }
    const ticket = await this.ticketOf(booking, booking.reference);
    return {
      filename: `e-ticket-${booking.reference}.pdf`,
      pdf: await renderETicket(ticket),
    };
  }

  /** Reads each segment's flight, airline and airport time zones, then builds the ticket. */
  private async ticketOf(
    booking: FlightBookingSource,
    reference: string,
  ): Promise<ETicket> {
    const flights = await this.flights
      .find({ _id: { $in: booking.segments.map((s) => s.flightId) } })
      .select(
        'flightNumber departureAirport arrivalAirport departureAt arrivalAt',
      )
      .lean()
      .exec();
    const zones = await this.flightResponses.timeZonesOf(
      flights.flatMap((f) => [f.departureAirport, f.arrivalAirport]),
    );
    const airlineNames = await Promise.all(
      booking.segments.map(
        async (segment) =>
          (await this.airlines.findEntityOrThrow(segment.airlineId.toString()))
            .name,
      ),
    );
    const [seats, changes] = await Promise.all([
      this.seats.findByBooking(booking._id),
      this.changes.summariesOf(booking._id),
    ]);
    return buildETicket(
      booking,
      reference,
      flights,
      airlineNames,
      zones,
      seats,
      changes,
    );
  }
}

/** A flight as the e-ticket reads it. */
export interface ETicketFlight {
  _id: Types.ObjectId;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureAt: Date;
  arrivalAt: Date;
}

/**
 * FLT-23: what the e-ticket shows, from the booking and what was read for it
 * (`airlineNames` in segment order). Times are shown at each airport with
 * luxon (GEN-06), never by adding hours; the passport is masked; money comes
 * from whole cents. A missing flight is 404; an airport with no zone throws,
 * since no zone is guessed. FLT-27: the legs are the flights the booking
 * flies now, and each completed or pending flight change has a line.
 */
export function buildETicket(
  booking: FlightBookingSource,
  reference: string,
  flights: readonly ETicketFlight[],
  airlineNames: readonly string[],
  zones: ReadonlyMap<string, string>,
  seats: readonly SeatRecord[],
  changes: readonly FlightChangeSummaryDto[] = [],
): ETicket {
  const zoneOf = (code: string): string => {
    const zone = zones.get(code);
    if (!zone) {
      throw new Error(`Airport ${code} has no time zone`);
    }
    return zone;
  };
  const legs = booking.segments.map((segment, index) => {
    const flight = flights.find((f) => f._id.equals(segment.flightId));
    if (!flight) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    const departure = toLocalTime(
      flight.departureAt,
      zoneOf(flight.departureAirport),
    );
    const arrival = toLocalTime(
      flight.arrivalAt,
      zoneOf(flight.arrivalAirport),
    );
    return {
      label: index === 0 ? 'Outbound' : 'Return',
      airlineName: airlineNames[index],
      flightNumber: flight.flightNumber,
      departureAirport: flight.departureAirport,
      arrivalAirport: flight.arrivalAirport,
      departureLocal: departure.local.replace('T', ' '),
      departureTimeZone: departure.timeZone,
      departureUtcOffset: departure.utcOffset,
      arrivalLocal: arrival.local.replace('T', ' '),
      arrivalTimeZone: arrival.timeZone,
      arrivalUtcOffset: arrival.utcOffset,
      cabin: CABIN_LABELS[segment.cabin],
      seats: segment.seatsReserved,
      freeBaggage: freeBaggageOf(segment),
    };
  });

  return {
    reference,
    legs,
    passengers: (booking.passengers ?? []).map((passenger, passengerIndex) => ({
      fullName: passenger.fullName,
      type: capitalised(passenger.type),
      passport: maskPassport(passenger.passportNumber),
      extraBaggage: booking.segments.map((_segment, index) =>
        extraBaggageOf(passenger, index),
      ),
      seats: booking.segments.map((_segment, segmentIndex) =>
        seatLineOf(passenger, passengerIndex, segmentIndex, seats),
      ),
    })),
    seats: booking.segments[0].seatsReserved,
    totalPaid: formatMoney(booking.total, booking.currency),
    changes: changeLinesOf(changes, booking.currency),
  };
}

/**
 * FLT-27: the e-ticket's lines about flight changes, oldest first: each
 * completed change with its date and what happened to the price, and a
 * change waiting for payment (this ticket still shows the booked flight).
 * Expired changes never happened and are not listed. Dates are UTC.
 */
export function changeLinesOf(
  changes: readonly FlightChangeSummaryDto[],
  currency: string,
): string[] {
  const label = (index: number) => (index === 0 ? 'Outbound' : 'Return');
  const day = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
  return [...changes].reverse().flatMap((change) => {
    if (change.status === FlightChangeStatus.Completed && change.completedAt) {
      const money =
        change.difference > 0
          ? `fare difference paid: ${formatMoney(change.difference, currency)}`
          : change.difference < 0
            ? `fare difference refunded: ${formatMoney(-change.difference, currency)}`
            : 'same price';
      return [
        `${label(change.segmentIndex)} flight changed on ${day(change.completedAt)} (${money})`,
      ];
    }
    if (
      change.status === FlightChangeStatus.PendingPayment &&
      change.holdExpiresAt
    ) {
      return [
        `${label(change.segmentIndex)} flight change waiting for payment until ${day(change.holdExpiresAt)}: this ticket shows the booked flight`,
      ];
    }
    return [];
  });
}
