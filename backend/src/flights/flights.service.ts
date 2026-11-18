import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import type { Model } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import { Airport } from '../reference/models/airport.schema';
import { AirlinesService } from './airlines.service';
import type { CreateFlightDto } from './dto/create-flight.dto';
import type { FlightResponseDto } from './dto/flight-response.dto';
import { DUPLICATE_FLIGHT_MESSAGE } from './flights.constants';
import { toFlightResponse } from './mappers/flight.mapper';
import { FlightStatus } from './models/flight-status.enum';
import { Flight } from './models/flight.schema';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

type FlightField = keyof CreateFlightDto;

/** The fields in the order of the DTO, so the errors always come in that order. */
const FIELD_ORDER: readonly FlightField[] = [
  'flightNumber',
  'departureAirport',
  'arrivalAirport',
  'departureLocal',
  'arrivalLocal',
];

/** Collects the field errors of one request, so the client gets them all at once. */
class FieldErrors {
  private readonly byField = new Map<FlightField, string[]>();

  add(field: FlightField, message: string): void {
    this.byField.set(field, [...(this.byField.get(field) ?? []), message]);
  }

  /** One 400 in the project's shape, `{ message, errors: [{ field, messages }] }`. */
  throwIfAny(): void {
    if (this.byField.size === 0) {
      return;
    }
    const errors: FieldError[] = FIELD_ORDER.filter((field) =>
      this.byField.has(field),
    ).map((field) => ({ field, messages: this.byField.get(field) ?? [] }));
    throw new BadRequestException({ message: 'Validation failed', errors });
  }
}

/** The format a local date-time is typed in, with or without seconds. */
const formatOf = (value: string): string =>
  value.length > 'YYYY-MM-DDTHH:mm'.length
    ? "yyyy-MM-dd'T'HH:mm:ss"
    : "yyyy-MM-dd'T'HH:mm";

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    private readonly airlines: AirlinesService,
  ) {}

  /**
   * FLT-03: an airline moderator creates a flight of their assigned airline.
   * The local times are read in each airport's IANA time zone and stored in
   * UTC. The independent rules are all checked before one 400 lists every
   * broken one. The duplicate rule is the unique index: the insert itself
   * answers 409, so two requests at the same moment cannot both pass.
   */
  async create(
    dto: CreateFlightDto,
    userId: string,
  ): Promise<FlightResponseDto> {
    const airline = await this.airlines.findAssignedAirlineOrThrow(userId);
    const zones = await this.timeZonesOf([
      dto.departureAirport,
      dto.arrivalAirport,
    ]);
    const errors = new FieldErrors();

    const departureZone = zones.get(dto.departureAirport);
    const arrivalZone = zones.get(dto.arrivalAirport);
    if (!departureZone) {
      errors.add(
        'departureAirport',
        `departureAirport ${dto.departureAirport} is not in the airports list`,
      );
    }
    if (!arrivalZone) {
      errors.add(
        'arrivalAirport',
        `arrivalAirport ${dto.arrivalAirport} is not in the airports list`,
      );
    }
    if (dto.departureAirport === dto.arrivalAirport) {
      errors.add(
        'arrivalAirport',
        'arrivalAirport must be different from departureAirport',
      );
    }

    const departure =
      departureZone &&
      this.toInstant(
        dto.departureLocal,
        departureZone,
        'departureLocal',
        errors,
      );
    const arrival =
      arrivalZone &&
      this.toInstant(dto.arrivalLocal, arrivalZone, 'arrivalLocal', errors);

    if (departure && departure <= DateTime.now()) {
      errors.add('departureLocal', 'departureLocal must be in the future');
    }
    if (departure && arrival && arrival <= departure) {
      errors.add(
        'arrivalLocal',
        'arrivalLocal must be after departureLocal, compared in UTC',
      );
    }
    errors.throwIfAny();

    // Both are set here: a missing one added an error above.
    const departureAt = departure as DateTime;
    const arrivalAt = arrival as DateTime;
    try {
      const flight = await this.flights.create({
        airlineId: airline._id,
        flightNumber: dto.flightNumber,
        departureAirport: dto.departureAirport,
        arrivalAirport: dto.arrivalAirport,
        departureAt: departureAt.toJSDate(),
        arrivalAt: arrivalAt.toJSDate(),
        departureDateLocal: departureAt.toFormat('yyyy-MM-dd'),
        status: FlightStatus.Scheduled,
      });
      return toFlightResponse(flight);
    } catch (error) {
      // The unique (airlineId, flightNumber, departureDateLocal) index, for
      // every status: a cancelled flight still holds its number and date.
      if (isDuplicateKey(error)) {
        throw new ConflictException(DUPLICATE_FLIGHT_MESSAGE);
      }
      throw error;
    }
  }

  /** The IANA time zone of each known airport code, read in one query. */
  private async timeZonesOf(
    codes: readonly string[],
  ): Promise<Map<string, string>> {
    const airports = await this.airports
      .find({ _id: { $in: [...new Set(codes)] } })
      .select('timeZone')
      .lean<{ _id: string; timeZone: string }[]>()
      .exec();
    return new Map(airports.map((airport) => [airport._id, airport.timeZone]));
  }

  /**
   * The instant a local date-time names in a time zone, converted by luxon
   * (never by adding hours). A time inside a clock change that skips it does
   * not exist: luxon would silently move it forward, so the converted value
   * is formatted back in the zone and must equal the input, or the field gets
   * an error. A time that happens twice (the clocks go back) is accepted as
   * the instant luxon picks, the second one (standard time).
   */
  private toInstant(
    value: string,
    zone: string,
    field: 'departureLocal' | 'arrivalLocal',
    errors: FieldErrors,
  ): DateTime | undefined {
    const instant = DateTime.fromISO(value, { zone });
    if (!instant.isValid) {
      errors.add(field, `${field} must be a real calendar date and time`);
      return undefined;
    }
    if (instant.toFormat(formatOf(value)) !== value) {
      errors.add(
        field,
        `${field} ${value} does not exist in ${zone}: the clocks skip that time (daylight saving change)`,
      );
      return undefined;
    }
    return instant;
  }
}
