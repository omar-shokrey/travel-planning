import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Airport } from '../reference/models/airport.schema';
import type { FlightResponseDto } from './dto/flight-response.dto';
import { type FlightSource, toFlightResponse } from './mappers/flight.mapper';

/**
 * GEN-06: the one place that turns stored flights into API responses, with
 * every time shown at its own airport. Every route that returns a flight
 * uses it (FLT-11 search, FLT-17 details, FLT-23 e-ticket, FLT-25 my
 * bookings, FLT-29 passenger export), so local times are shown everywhere.
 * The airports' time zones of a whole list are read in one query.
 */
@Injectable()
export class FlightResponsesService {
  constructor(
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
  ) {}

  /** One stored flight as the API returns it, with its local times. */
  async toResponse(
    flight: FlightSource,
    now: Date,
  ): Promise<FlightResponseDto> {
    const [response] = await this.toResponses([flight], now);
    return response;
  }

  /**
   * Stored flights as the API returns them, in the same order. The time
   * zones of all their airports are read in one query, never one per flight.
   * An airport with no zone (missing from the reference data) throws: no
   * zone is guessed and UTC is never used instead.
   */
  async toResponses(
    flights: readonly FlightSource[],
    now: Date,
  ): Promise<FlightResponseDto[]> {
    if (flights.length === 0) {
      return [];
    }
    const zones = await this.timeZonesOf(
      flights.flatMap((flight) => [
        flight.departureAirport,
        flight.arrivalAirport,
      ]),
    );
    return flights.map((flight) =>
      toFlightResponse(flight, now, {
        departure: zoneOf(zones, flight.departureAirport),
        arrival: zoneOf(zones, flight.arrivalAirport),
      }),
    );
  }

  /** The IANA time zone of each known airport code, read in one query. */
  async timeZonesOf(codes: readonly string[]): Promise<Map<string, string>> {
    const airports = await this.airports
      .find({ _id: { $in: [...new Set(codes)] } })
      .select('timeZone')
      .lean<{ _id: string; timeZone: string }[]>()
      .exec();
    return new Map(airports.map((airport) => [airport._id, airport.timeZone]));
  }
}

/** The zone of a stored flight's airport, or an error naming the code. */
function zoneOf(zones: ReadonlyMap<string, string>, code: string): string {
  const zone = zones.get(code);
  if (!zone) {
    throw new Error(
      `Airport ${code} of a stored flight has no time zone in the airports list`,
    );
  }
  return zone;
}
