import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { AirlinesService } from './airlines.service';
import type { CreateCabinDto } from './dto/create-cabin.dto';
import type { FlightResponseDto } from './dto/flight-response.dto';
import type { UpdateCabinDto } from './dto/update-cabin.dto';
import {
  CABIN_CHANGED_MESSAGE,
  CABIN_UPDATE_ATTEMPTS,
  CABIN_NOT_FOUND_MESSAGE,
  duplicateCabinMessage,
  EMPTY_CABIN_UPDATE_MESSAGE,
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
} from './flights.constants';
import type { CabinSource, FlightSource } from './mappers/flight.mapper';
import { assertEditable } from './flight-editable';
import { FlightResponsesService } from './flight-responses.service';
import { scheduledFlightFilter } from './flight-status';
import { Flight } from './models/flight.schema';

/** The cabin fields a moderator may change (FLT-04, FLT-05), in the order of the DTO. */
const EDITABLE_CABIN_FIELDS = [
  'totalSeats',
  'price',
  'freeBags',
  'maxBagKg',
] as const;

type EditableCabinField = (typeof EDITABLE_CABIN_FIELDS)[number];

/** What the service reads of a flight to check a change, or to tell why a write matched nothing. */
type FlightState = Pick<Flight, 'airlineId' | 'status' | 'departureAt'> & {
  cabins?: CabinSource[];
};

/**
 * The cabin categories of a flight (FLT-04): an airline moderator adds them
 * and edits them, for a scheduled flight of their own airline. Every rule
 * that depends on the stored flight is part of the write's filter, so a
 * concurrent request can never slip between a check and the write.
 * "Scheduled" is `scheduledFlightFilter(now)` (FLT-30), with one `now` per
 * request: a flight that departs between the check and the write is never
 * changed.
 */
@Injectable()
export class FlightCabinsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly airlines: AirlinesService,
    private readonly responses: FlightResponsesService,
  ) {}

  /**
   * Adds a cabin category to a flight. One conditional `$push` decides
   * everything at once: the flight is the moderator's, it is scheduled, and it
   * has no cabin of this class yet. Five identical requests at the same moment
   * therefore give one cabin. When nothing matched, one read tells why.
   */
  async addCabin(
    flightId: string,
    dto: CreateCabinDto,
    userId: string,
  ): Promise<FlightResponseDto> {
    const now = new Date();
    const airline = await this.airlines.findAssignedAirlineOrThrow(userId);
    const cabin = {
      _id: new Types.ObjectId(),
      cabin: dto.cabin,
      totalSeats: dto.totalSeats,
      bookedSeats: 0,
      heldSeats: 0,
      price: dto.price,
      freeBags: dto.freeBags,
      maxBagKg: dto.maxBagKg,
    };

    const { matchedCount } = await this.flights
      .updateOne(
        {
          _id: flightId,
          airlineId: airline._id,
          ...scheduledFlightFilter(now),
          'cabins.cabin': { $ne: dto.cabin },
        },
        { $push: { cabins: cabin } },
        { runValidators: true },
      )
      .exec();

    if (matchedCount === 0) {
      const flight = await this.readState(flightId);
      assertEditable(flight, airline._id, now);
      if (flight.cabins?.some((existing) => existing.cabin === dto.cabin)) {
        throw new ConflictException(duplicateCabinMessage(dto.cabin));
      }
      // The flight matched none of the reasons above when it was read again:
      // it changed between the write and the read.
      throw new ConflictException(FLIGHT_CHANGED_MESSAGE);
    }
    return this.reload(flightId, now);
  }

  /**
   * Changes the seat count, the price or the baggage allowance of a cabin
   * (FLT-04, FLT-05). Compare-and-set: the write matches only if the flight is
   * still the moderator's and scheduled at `now`, and the cabin's seat counters are
   * still the ones the seat floor was checked against. If a booking moved them
   * in between, the cabin is read and checked again, up to
   * `CABIN_UPDATE_ATTEMPTS` times. A new price applies to new bookings only:
   * a booking copies the price it was made at.
   */
  async updateCabin(
    flightId: string,
    cabinId: string,
    dto: UpdateCabinDto,
    userId: string,
  ): Promise<FlightResponseDto> {
    const changes: Partial<Record<`cabins.$.${EditableCabinField}`, number>> =
      {};
    for (const field of EDITABLE_CABIN_FIELDS) {
      const value = dto[field];
      if (value !== undefined) {
        changes[`cabins.$.${field}`] = value;
      }
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException(EMPTY_CABIN_UPDATE_MESSAGE);
    }

    const now = new Date();
    const airline = await this.airlines.findAssignedAirlineOrThrow(userId);
    for (let attempt = 1; attempt <= CABIN_UPDATE_ATTEMPTS; attempt += 1) {
      const flight = await this.readState(flightId);
      assertEditable(flight, airline._id, now);
      const cabin = flight.cabins?.find((existing) =>
        existing._id.equals(cabinId),
      );
      if (!cabin) {
        throw new NotFoundException(CABIN_NOT_FOUND_MESSAGE);
      }
      const taken = cabin.bookedSeats + cabin.heldSeats;
      if (dto.totalSeats !== undefined && dto.totalSeats < taken) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: [
            {
              field: 'totalSeats',
              messages: [
                // taken is at least 2 here: the DTO refuses fewer than 1 seat.
                `totalSeats cannot be below the ${taken} seats already booked or held`,
              ],
            },
          ],
        });
      }

      const { matchedCount } = await this.flights
        .updateOne(
          {
            _id: flightId,
            airlineId: airline._id,
            ...scheduledFlightFilter(now),
            cabins: {
              $elemMatch: {
                _id: cabin._id,
                bookedSeats: cabin.bookedSeats,
                heldSeats: cabin.heldSeats,
              },
            },
          },
          { $set: changes },
          { runValidators: true },
        )
        .exec();
      // Matched is enough: values equal to the stored ones are a success too.
      if (matchedCount === 1) {
        return this.reload(flightId, now);
      }
    }
    throw new ConflictException(CABIN_CHANGED_MESSAGE);
  }

  private readState(flightId: string): Promise<FlightState | null> {
    return this.flights
      .findById(flightId)
      .select('airlineId status departureAt cabins')
      .lean<FlightState>()
      .exec();
  }

  /** The flight after a successful change, as the API returns it (with its local times, GEN-06). */
  private async reload(
    flightId: string,
    now: Date,
  ): Promise<FlightResponseDto> {
    const flight = await this.flights
      .findById(flightId)
      .lean<FlightSource>()
      .exec();
    if (!flight) {
      throw new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE);
    }
    return this.responses.toResponse(flight, now);
  }
}
