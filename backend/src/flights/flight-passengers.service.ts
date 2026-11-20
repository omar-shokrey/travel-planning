import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { FlightBookingStatus } from '../flight-bookings/enums/flight-booking-status.enum';
import { FlightBooking } from '../flight-bookings/models/flight-booking.schema';
import { AirlinesService } from './airlines.service';
import type {
  FlightBookingOfFlightDto,
  FlightBookingsResponseDto,
} from './dto/flight-bookings-response.dto';
import { toPassengerCsv } from './flight-passengers-csv';
import { FlightResponsesService } from './flight-responses.service';
import {
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import {
  type BookingOfFlightSource,
  toFlightBookingOfFlight,
} from './mappers/flight-booking-of-flight.mapper';
import type { FlightSource } from './mappers/flight.mapper';
import { Flight } from './models/flight.schema';

/** The bookings an airline sees: paid ones. A hold or an expired one is not a booking yet. */
export const AIRLINE_VISIBLE_STATUSES = [
  FlightBookingStatus.Confirmed,
  FlightBookingStatus.Completed,
  FlightBookingStatus.Cancelled,
];

/** The bookings whose passengers fly: on the passenger list and in the count. */
const FLYING_STATUSES = new Set([
  FlightBookingStatus.Confirmed,
  FlightBookingStatus.Completed,
]);

export interface PassengerCsvFile {
  filename: string;
  csv: Buffer;
}

/**
 * FLT-29: an airline moderator views the bookings of one of their airline's
 * flights (reference, passenger names, cabin, seats and status), the seats
 * remaining per cabin, and exports the passenger list as CSV. The booking
 * module owns the bookings; this service only reads them, through the
 * FlightBooking model registered read-only in FlightsModule (the booking
 * module imports this one, so it cannot be the other way round).
 */
@Injectable()
export class FlightPassengersService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    // Read only.
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly airlines: AirlinesService,
    private readonly responses: FlightResponsesService,
  ) {}

  /**
   * The flight (with each cabin's `availableSeats`) and its paid bookings,
   * ordered by reference. Any flight status: a cancelled or departed flight
   * still has its bookings.
   */
  async bookingsOf(
    flightId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<FlightBookingsResponseDto> {
    const flight = await this.findOwnFlight(flightId, userId);
    const bookings = await this.readBookings(flightId);
    return {
      flight: await this.responses.toResponse(flight, now),
      bookings,
      passengerCount: bookings
        .filter(({ status }) => FLYING_STATUSES.has(status))
        .reduce((count, booking) => count + booking.passengers.length, 0),
    };
  }

  /** The passenger list as a CSV file: the passengers of the confirmed and completed bookings. */
  async passengerCsv(
    flightId: string,
    userId: string,
  ): Promise<PassengerCsvFile> {
    const flight = await this.findOwnFlight(flightId, userId);
    const flying = (await this.readBookings(flightId)).filter(({ status }) =>
      FLYING_STATUSES.has(status),
    );
    return {
      filename: `passengers-${flight.flightNumber}-${flight.departureDateLocal}.csv`,
      csv: Buffer.from(toPassengerCsv(flying), 'utf8'),
    };
  }

  /**
   * The flight, if it belongs to the moderator's assigned airline: 403 for
   * a moderator with no airline (AirlinesService) or another airline's
   * flight, 404 for a missing one.
   */
  private async findOwnFlight(
    flightId: string,
    userId: string,
  ): Promise<FlightSource> {
    const airline = await this.airlines.findAssignedAirlineOrThrow(userId);
    const flight = await this.flights.findById(flightId).lean().exec();
    if (!flight) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    if (!flight.airlineId.equals(airline._id)) {
      throw new ForbiddenException(FOREIGN_FLIGHT_MESSAGE);
    }
    return flight;
  }

  /** The paid bookings with a segment on this flight, each with that segment's cabin and seats. */
  private async readBookings(
    flightId: string,
  ): Promise<FlightBookingOfFlightDto[]> {
    const id = new Types.ObjectId(flightId);
    const stored = await this.bookings
      .find({
        'segments.flightId': id,
        status: { $in: AIRLINE_VISIBLE_STATUSES },
      })
      .select('reference status segments passengers cancelledAt')
      .sort({ reference: 1 })
      .lean<BookingOfFlightSource[]>()
      .exec();
    return stored.map((booking) => toFlightBookingOfFlight(booking, id));
  }
}
