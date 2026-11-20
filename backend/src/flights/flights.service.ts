import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import type { Model, QueryFilter, Types } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { AirlinesService } from './airlines.service';
import type { CreateFlightDto } from './dto/create-flight.dto';
import type { FlightResponseDto } from './dto/flight-response.dto';
import type { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightBookingLookup } from './flight-booking-lookup.service';
import {
  type FlightSchedule,
  flightTimeChangeMessage,
  minuteOf,
} from './flight-change-message';
import { assertEditable, type EditableFlight } from './flight-editable';
import { FlightResponsesService } from './flight-responses.service';
import { effectiveStatus, scheduledFlightFilter } from './flight-status';
import {
  AIRPORTS_LOCKED_MESSAGE,
  DUPLICATE_FLIGHT_MESSAGE,
  EMPTY_FLIGHT_UPDATE_MESSAGE,
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_CANCELLABLE_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
  SAME_AIRPORTS_MESSAGE,
  SAME_DEPARTURE_AIRPORT_MESSAGE,
  unknownAirportMessage,
} from './flights.constants';
import { type FlightSource, toFlightResponse } from './mappers/flight.mapper';
import { FlightStatus } from './models/flight-status.enum';
import type { FlightCabin } from './models/flight.schema';
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

/** The fields of the flight edit (FLT-05), in the order of its DTO. */
const UPDATE_FIELDS = [
  'departureAirport',
  'arrivalAirport',
  'departureLocal',
  'arrivalLocal',
] as const;

/** What the edit reads of a flight: the rules are checked against these values. */
type EditState = EditableFlight &
  Pick<
    Flight,
    'flightNumber' | 'departureAirport' | 'arrivalAirport' | 'arrivalAt'
  > & {
    _id: Types.ObjectId;
    cabins?: Pick<FlightCabin, 'bookedSeats' | 'heldSeats'>[];
  };

/**
 * No cabin has a seat booked or held (FLT-05): part of the write's filter when
 * the airports change, so a hold that arrives at the same moment (FLT-22
 * changes these counters in the same document) can never slip between the
 * check and the write.
 */
const NO_SEATS_TAKEN: QueryFilter<Flight> = {
  $nor: [
    { 'cabins.bookedSeats': { $gt: 0 } },
    { 'cabins.heldSeats': { $gt: 0 } },
  ],
};

const seatsTaken = (flight: EditState): boolean =>
  (flight.cabins ?? []).some(
    (cabin) => cabin.bookedSeats > 0 || cabin.heldSeats > 0,
  );

/** The format a local date-time is typed in, with or without seconds. */
const formatOf = (value: string): string =>
  value.length > 'YYYY-MM-DDTHH:mm'.length
    ? "yyyy-MM-dd'T'HH:mm:ss"
    : "yyyy-MM-dd'T'HH:mm";

/** FLT-06: the cancelled flight, as the booking module needs it for the cascade and the response. */
export type CancelledFlight = FlightSource & { _id: Types.ObjectId };

@Injectable()
export class FlightsService {
  private readonly logger = new Logger(FlightsService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly airlines: AirlinesService,
    private readonly responses: FlightResponsesService,
    private readonly bookings: FlightBookingLookup,
    private readonly notifications: NotificationsService,
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
    const zones = await this.responses.timeZonesOf([
      dto.departureAirport,
      dto.arrivalAirport,
    ]);
    const errors = new FieldErrors();

    const departureZone = zones.get(dto.departureAirport);
    const arrivalZone = zones.get(dto.arrivalAirport);
    if (!departureZone) {
      errors.add(
        'departureAirport',
        unknownAirportMessage('departureAirport', dto.departureAirport),
      );
    }
    if (!arrivalZone) {
      errors.add(
        'arrivalAirport',
        unknownAirportMessage('arrivalAirport', dto.arrivalAirport),
      );
    }
    if (dto.departureAirport === dto.arrivalAirport) {
      errors.add('arrivalAirport', SAME_AIRPORTS_MESSAGE);
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

    // All four are set here: a missing one added an error above.
    const departureAt = departure as DateTime;
    const arrivalAt = arrival as DateTime;
    const flightZones = {
      departure: departureZone as string,
      arrival: arrivalZone as string,
    };
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
      // The zones were read above, so the response needs no second query (GEN-06).
      return toFlightResponse(flight, new Date(), flightZones);
    } catch (error) {
      // The unique (airlineId, flightNumber, departureDateLocal) index, for
      // every status: a cancelled flight still holds its number and date.
      if (isDuplicateKey(error)) {
        throw new ConflictException(DUPLICATE_FLIGHT_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * FLT-05: an airline moderator changes the times or the airports of a
   * scheduled flight of their airline. The times are typed in each airport's
   * local time and checked with the rules of FLT-03 against the values the
   * flight keeps; all broken rules are listed in one 400.
   *
   * The airports cannot change once the flight has a booking: a booking that
   * waits for its payment or is confirmed is read before the write, and the
   * seats booked or held are part of the write's filter. Times can always
   * change: the passengers with a confirmed booking are then notified, after
   * the write (see `notifyTimeChange`).
   *
   * One conditional write (`findOneAndUpdate`, which also returns the flight
   * as written): it matches only while the flight is still the moderator's,
   * scheduled at `now` (FLT-30) and exactly as it was read, so a concurrent
   * change can never combine with this one into a flight whose arrival is
   * before its departure.
   */
  async update(
    flightId: string,
    dto: UpdateFlightDto,
    userId: string,
  ): Promise<FlightResponseDto> {
    if (UPDATE_FIELDS.every((field) => dto[field] === undefined)) {
      throw new BadRequestException(EMPTY_FLIGHT_UPDATE_MESSAGE);
    }

    const now = new Date();
    const airline = await this.airlines.findAssignedAirlineOrThrow(userId);
    const stored = await this.readEditState(flightId);
    assertEditable(stored, airline._id, now);

    const departureAirport = dto.departureAirport ?? stored.departureAirport;
    const arrivalAirport = dto.arrivalAirport ?? stored.arrivalAirport;
    const airportsChange =
      departureAirport !== stored.departureAirport ||
      arrivalAirport !== stored.arrivalAirport;

    // The zones of the old and the new airports, in one query.
    const zones = await this.responses.timeZonesOf([
      stored.departureAirport,
      stored.arrivalAirport,
      departureAirport,
      arrivalAirport,
    ]);
    const errors = new FieldErrors();
    const zoneOf = (
      field: 'departureAirport' | 'arrivalAirport',
      code: string,
    ): string | undefined => {
      const zone = zones.get(code);
      if (!zone && dto[field] !== undefined) {
        errors.add(field, unknownAirportMessage(field, code));
      } else if (!zone) {
        throw new Error(
          `Airport ${code} of a stored flight has no time zone in the airports list`,
        );
      }
      return zone;
    };
    const departureZone = zoneOf('departureAirport', departureAirport);
    const arrivalZone = zoneOf('arrivalAirport', arrivalAirport);
    if (departureAirport === arrivalAirport) {
      if (dto.arrivalAirport !== undefined) {
        errors.add('arrivalAirport', SAME_AIRPORTS_MESSAGE);
      } else {
        errors.add('departureAirport', SAME_DEPARTURE_AIRPORT_MESSAGE);
      }
    }

    // A time that is not sent keeps its instant, even at a new airport.
    let departureAt: Date | undefined = stored.departureAt;
    if (dto.departureLocal !== undefined) {
      departureAt = departureZone
        ? this.toInstant(
            dto.departureLocal,
            departureZone,
            'departureLocal',
            errors,
          )?.toJSDate()
        : undefined;
      if (departureAt && departureAt <= now) {
        errors.add('departureLocal', 'departureLocal must be in the future');
      }
    }
    let arrivalAt: Date | undefined = stored.arrivalAt;
    if (dto.arrivalLocal !== undefined) {
      arrivalAt = arrivalZone
        ? this.toInstant(
            dto.arrivalLocal,
            arrivalZone,
            'arrivalLocal',
            errors,
          )?.toJSDate()
        : undefined;
    }
    if (departureAt && arrivalAt && arrivalAt <= departureAt) {
      if (dto.arrivalLocal !== undefined) {
        errors.add(
          'arrivalLocal',
          'arrivalLocal must be after departureLocal, compared in UTC',
        );
      } else {
        errors.add(
          'departureLocal',
          'departureLocal must be before the arrival, compared in UTC',
        );
      }
    }
    errors.throwIfAny();

    // All four are set here: a missing one added an error above.
    const after: FlightSchedule = {
      departureAirport,
      arrivalAirport,
      departureAt: departureAt as Date,
      arrivalAt: arrivalAt as Date,
      departureZone: departureZone as string,
      arrivalZone: arrivalZone as string,
    };
    const before: FlightSchedule = {
      departureAirport: stored.departureAirport,
      arrivalAirport: stored.arrivalAirport,
      departureAt: stored.departureAt,
      arrivalAt: stored.arrivalAt,
      departureZone: zones.get(stored.departureAirport) as string,
      arrivalZone: zones.get(stored.arrivalAirport) as string,
    };

    if (airportsChange && (await this.bookings.hasActiveBooking(flightId))) {
      throw new ConflictException(AIRPORTS_LOCKED_MESSAGE);
    }

    const filter: QueryFilter<Flight> = {
      $and: [
        { _id: stored._id, airlineId: airline._id },
        scheduledFlightFilter(now),
        // Compare-and-set: the flight is still as the rules saw it.
        {
          departureAirport: stored.departureAirport,
          arrivalAirport: stored.arrivalAirport,
          departureAt: stored.departureAt,
          arrivalAt: stored.arrivalAt,
        },
        ...(airportsChange ? [NO_SEATS_TAKEN] : []),
      ],
    };
    let updated: FlightSource | null;
    try {
      // One atomic call: the answer is the flight exactly as this write left it.
      updated = await this.flights
        .findOneAndUpdate(
          filter,
          {
            $set: {
              departureAirport: after.departureAirport,
              arrivalAirport: after.arrivalAirport,
              departureAt: after.departureAt,
              arrivalAt: after.arrivalAt,
              // The departure date at the (new) departure airport (FLT-11 searches by it).
              departureDateLocal: DateTime.fromJSDate(after.departureAt, {
                zone: after.departureZone,
              }).toFormat('yyyy-MM-dd'),
            },
          },
          { returnDocument: 'after', runValidators: true },
        )
        .lean<FlightSource>()
        .exec();
    } catch (error) {
      // The new local date can clash with another flight of the same number (FLT-03).
      if (isDuplicateKey(error)) {
        throw new ConflictException(DUPLICATE_FLIGHT_MESSAGE);
      }
      throw error;
    }

    if (!updated) {
      const current = await this.readEditState(flightId);
      assertEditable(current, airline._id, now);
      if (airportsChange && seatsTaken(current)) {
        throw new ConflictException(AIRPORTS_LOCKED_MESSAGE);
      }
      // It matched none of the reasons above when it was read again: it
      // changed between the read and the write.
      throw new ConflictException(FLIGHT_CHANGED_MESSAGE);
    }

    if (
      minuteOf(after.departureAt) !== minuteOf(before.departureAt) ||
      minuteOf(after.arrivalAt) !== minuteOf(before.arrivalAt)
    ) {
      await this.notifyTimeChange(flightId, stored.flightNumber, before, after);
    }
    // The zones were read above, so the response needs no second query (GEN-06).
    return toFlightResponse(updated, now, {
      departure: after.departureZone,
      arrival: after.arrivalZone,
    });
  }

  /**
   * FLT-06: the airline moderator cancels a scheduled flight of their
   * airline. One conditional update sets `cancelled` only if the flight is
   * the moderator's airline's and still scheduled at `now` (FLT-30), so two
   * cancellations, or a cancellation and an edit at the same moment, cannot
   * both succeed. A cancelled flight is no longer found by search (FLT-11),
   * held or booked (FLT-22). When nothing matched, one read tells why: 404,
   * 403, 409 for a flight that is cancelled or has departed, or 409 when it
   * changed in between. Returns the cancelled flight; what it means for the
   * bookings (FLT-06) is done by the booking module, which calls this.
   */
  async cancel(
    flightId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<CancelledFlight> {
    const airline = await this.airlines.findAssignedAirlineOrThrow(userId);
    const cancelled = await this.flights
      .findOneAndUpdate(
        {
          _id: flightId,
          airlineId: airline._id,
          ...scheduledFlightFilter(now),
        },
        { $set: { status: FlightStatus.Cancelled } },
        { returnDocument: 'after' },
      )
      .lean<CancelledFlight>()
      .exec();
    if (cancelled) {
      return cancelled;
    }
    const current = await this.readEditState(flightId);
    if (!current) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    if (!current.airlineId.equals(airline._id)) {
      throw new ForbiddenException(FOREIGN_FLIGHT_MESSAGE);
    }
    if (effectiveStatus(current, now) !== FlightStatus.Scheduled) {
      throw new ConflictException(FLIGHT_NOT_CANCELLABLE_MESSAGE);
    }
    throw new ConflictException(FLIGHT_CHANGED_MESSAGE);
  }

  /**
   * FLT-05, GEN-01: tells every user with a confirmed booking of the flight
   * that its times changed, one notification per user. It runs after the
   * flight is saved: a failure here is logged with the flight id only and the
   * edit still succeeds, because the new times are already what every booking
   * shows (a booking reads the flight's times, never a copy).
   */
  private async notifyTimeChange(
    flightId: string,
    flightNumber: string,
    before: FlightSchedule,
    after: FlightSchedule,
  ): Promise<void> {
    try {
      const userIds = await this.bookings.confirmedUserIds(flightId);
      if (userIds.length === 0) {
        return;
      }
      await this.notifications.notifyMany(
        userIds,
        NotificationType.FlightChanged,
        flightTimeChangeMessage(flightNumber, before, after),
        { type: NotificationLinkType.Flight, id: flightId },
      );
    } catch (error) {
      this.logger.error(
        `Could not notify the passengers of flight ${flightId} about its new times`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private readEditState(flightId: string): Promise<EditState | null> {
    return this.flights
      .findById(flightId)
      .select(
        'airlineId status flightNumber departureAirport arrivalAirport departureAt arrivalAt cabins.bookedSeats cabins.heldSeats',
      )
      .lean<EditState>()
      .exec();
  }

  /**
   * The instant a local date-time names in a time zone, converted by luxon
   * (never by adding hours). A time inside a clock change that skips it does
   * not exist: luxon would silently move it forward, so the converted value
   * is formatted back in the zone and must equal the input, or the field gets
   * an error.
   *
   * A time that happens twice (the clocks go back) is accepted. luxon's own
   * guess for it follows the zone's offset at the current moment, so the
   * same request would be stored an hour apart in summer and in winter.
   * The service therefore always takes the later of luxon's candidates
   * (`getPossibleOffsets()`, in UTC order): the second occurrence, which is
   * standard time in both hemispheres (New York 01:30 is 06:30 UTC).
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
    const candidates = instant.getPossibleOffsets();
    return candidates[candidates.length - 1] ?? instant;
  }
}
