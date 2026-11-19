import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { FlightDetailsResponseDto } from './dto/flight-details-response.dto';
import { FlightResponsesService } from './flight-responses.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from './flights.constants';
import {
  type DetailsAirlineSource,
  toFlightDetails,
} from './mappers/flight-details.mapper';
import type { FlightSource } from './mappers/flight.mapper';
import { Airline } from './models/airline.schema';
import { Flight } from './models/flight.schema';

/**
 * FLT-17: the flight details page, for guests and users. Read only. A flight
 * of a deactivated airline answers 404 like an unknown flight (ACC-15: its
 * listings are hidden). A cancelled or departed flight is shown, with its
 * status, so a booked passenger can still open it.
 */
@Injectable()
export class FlightDetailsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    private readonly responses: FlightResponsesService,
  ) {}

  async findDetails(
    flightId: string,
    now: Date = new Date(),
  ): Promise<FlightDetailsResponseDto> {
    const flight = await this.flights
      .findById(flightId)
      .lean<FlightSource>()
      .exec();
    if (!flight) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    const airline = await this.airlines
      .findById(flight.airlineId)
      .select('name code logo active policy')
      .lean<DetailsAirlineSource & { active?: boolean }>()
      .exec();
    // An airline without the field counts as active (README, "Deactivated airlines").
    if (!airline || airline.active === false) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    const zones = await this.responses.timeZonesOf([
      flight.departureAirport,
      flight.arrivalAirport,
    ]);
    const departure = zones.get(flight.departureAirport);
    const arrival = zones.get(flight.arrivalAirport);
    if (!departure || !arrival) {
      throw new Error(
        `An airport of flight ${flightId} has no time zone in the airports list`,
      );
    }
    return toFlightDetails(flight, airline, now, { departure, arrival });
  }
}
