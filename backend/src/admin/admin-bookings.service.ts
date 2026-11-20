import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage, Types } from 'mongoose';
import {
  type PaginatedResponse,
  paginate,
} from '../common/dto/paginated-response.dto';
import { FlightBooking } from '../flight-bookings/models/flight-booking.schema';
import { Airline } from '../flights/models/airline.schema';
import { Flight } from '../flights/models/flight.schema';
import { HotelBooking } from '../hotel-bookings/models/hotel-booking.schema';
import { Hotel } from '../hotels/models/hotel.schema';
import {
  type BookingKind,
  BookingType,
} from '../payments/enums/booking-type.enum';
import { User } from '../users/models/user.schema';
import type { AdminBookingResponseDto } from './dto/admin-booking-response.dto';
import type { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';
import {
  type AdminBookingLookups,
  type AdminBookingSource,
  type AdminFlightBookingSource,
  type AdminHotelBookingSource,
  toAdminBookingResponse,
} from './mappers/admin-booking.mapper';

/** One row of phase (a): which booking, of which kind, made when. */
export interface AdminBookingPageRow {
  _id: Types.ObjectId;
  createdAt: Date;
  kind: BookingKind;
}

/** The single result document of the `$facet` of phase (a). */
export interface AdminBookingPageFacet {
  items: AdminBookingPageRow[];
  total: { count: number }[];
}

/** Only what the mapper needs: never the passengers, prices or holds. */
export const ADMIN_FLIGHT_BOOKING_FIELDS =
  'reference userId status currency total createdAt segments.flightId segments.airlineId';
export const ADMIN_HOTEL_BOOKING_FIELDS =
  'reference userId hotelId checkIn checkOut status currency total createdAt';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type StoredFlightBooking = Omit<AdminFlightBookingSource, 'type'>;
type StoredHotelBooking = Omit<AdminHotelBookingSource, 'type'>;

/**
 * The admin list of all flight and hotel bookings (ACC-17). Read only: it
 * never writes. The booking modules own the writes; one merged, paginated
 * list across both collections needs one aggregation, so it reads them here
 * (see the admin README).
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async list(
    query: ListAdminBookingsQueryDto,
  ): Promise<PaginatedResponse<AdminBookingResponseDto>> {
    const { rows, total } = await this.findPage(query);
    if (rows.length === 0) {
      return paginate([], total, query);
    }
    return paginate(await this.hydrate(rows), total, query);
  }

  /**
   * `status` and the `createdAt` range [from 00:00 UTC, the day after `to`
   * 00:00 UTC), so the whole `to` day is included.
   */
  buildMatch(query: ListAdminBookingsQueryDto): Record<string, unknown> {
    const match: Record<string, unknown> = {};
    if (query.status !== undefined) {
      match.status = query.status;
    }
    const createdAt: Record<string, Date> = {};
    if (query.from !== undefined) {
      createdAt.$gte = new Date(`${query.from}T00:00:00.000Z`);
    }
    if (query.to !== undefined) {
      createdAt.$lt = new Date(
        new Date(`${query.to}T00:00:00.000Z`).getTime() + ONE_DAY_MS,
      );
    }
    if (Object.keys(createdAt).length > 0) {
      match.createdAt = createdAt;
    }
    return match;
  }

  /** Phase (a): one aggregation gives the ids of the page and the total. */
  private async findPage(
    query: ListAdminBookingsQueryDto,
  ): Promise<{ rows: AdminBookingPageRow[]; total: number }> {
    const match = this.buildMatch(query);
    const side = (kind: BookingKind): PipelineStage.FacetPipelineStage[] => [
      { $match: match },
      { $project: { _id: 1, createdAt: 1, kind: { $literal: kind } } },
    ];
    const tail: PipelineStage[] = [
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          items: [{ $skip: query.skip }, { $limit: query.limit }],
          total: [{ $count: 'count' }],
        },
      },
    ];
    let model: Model<FlightBooking> | Model<HotelBooking>;
    let pipeline: PipelineStage[];
    if (query.type === BookingType.Hotel) {
      model = this.hotelBookings;
      pipeline = [...side(BookingType.Hotel), ...tail];
    } else if (query.type === BookingType.Flight) {
      model = this.flightBookings;
      pipeline = [...side(BookingType.Flight), ...tail];
    } else {
      model = this.flightBookings;
      pipeline = [
        ...side(BookingType.Flight),
        {
          $unionWith: {
            coll: this.hotelBookings.collection.collectionName,
            pipeline: side(BookingType.Hotel),
          },
        },
        ...tail,
      ];
    }
    const [facet] = await (model as Model<FlightBooking>)
      .aggregate<AdminBookingPageFacet>(pipeline)
      .exec();
    return {
      rows: facet?.items ?? [],
      total: facet?.total[0]?.count ?? 0,
    };
  }

  /** Phase (b): read only the bookings of the page and what they point to. */
  private async hydrate(
    rows: AdminBookingPageRow[],
  ): Promise<AdminBookingResponseDto[]> {
    const idsOf = (kind: BookingKind) =>
      rows.filter((row) => row.kind === kind).map((row) => row._id);
    const flightIds = idsOf(BookingType.Flight);
    const hotelIds = idsOf(BookingType.Hotel);
    const [flightBookings, hotelBookings] = await Promise.all([
      flightIds.length === 0
        ? []
        : this.flightBookings
            .find({ _id: { $in: flightIds } })
            .select(ADMIN_FLIGHT_BOOKING_FIELDS)
            .lean<StoredFlightBooking[]>()
            .exec(),
      hotelIds.length === 0
        ? []
        : this.hotelBookings
            .find({ _id: { $in: hotelIds } })
            .select(ADMIN_HOTEL_BOOKING_FIELDS)
            .lean<StoredHotelBooking[]>()
            .exec(),
    ]);

    const segments = flightBookings.flatMap((booking) => booking.segments);
    const lookups = await this.loadLookups(
      [...flightBookings, ...hotelBookings].map((b) => b.userId),
      segments.map((segment) => segment.airlineId),
      hotelBookings.map((booking) => booking.hotelId),
      segments.map((segment) => segment.flightId),
    );

    const byKey = new Map<string, AdminBookingSource>([
      ...flightBookings.map(
        (b) =>
          [
            `${BookingType.Flight}:${b._id.toString()}`,
            { ...b, type: BookingType.Flight },
          ] as [string, AdminBookingSource],
      ),
      ...hotelBookings.map(
        (b) =>
          [
            `${BookingType.Hotel}:${b._id.toString()}`,
            { ...b, type: BookingType.Hotel },
          ] as [string, AdminBookingSource],
      ),
    ]);
    // The order of phase (a). A booking is never deleted, so each is found.
    return rows.flatMap((row) => {
      const booking = byKey.get(`${row.kind}:${row._id.toString()}`);
      return booking ? [toAdminBookingResponse(booking, lookups)] : [];
    });
  }

  /** One `$in` query per collection, only for the ids the page needs. */
  private async loadLookups(
    userIds: Types.ObjectId[],
    airlineIds: Types.ObjectId[],
    hotelIds: Types.ObjectId[],
    flightIds: Types.ObjectId[],
  ): Promise<AdminBookingLookups> {
    const byId = <T extends { _id: Types.ObjectId }>(
      docs: T[],
    ): Map<string, T> => new Map(docs.map((doc) => [doc._id.toString(), doc]));
    const inIds = (ids: Types.ObjectId[]) => ({ _id: { $in: unique(ids) } });
    type Named = { _id: Types.ObjectId; name: string };

    const [users, airlines, hotels, flights] = await Promise.all([
      userIds.length === 0
        ? []
        : this.users
            .find(inIds(userIds))
            .select('name email')
            .lean<(Named & { email: string })[]>()
            .exec(),
      airlineIds.length === 0
        ? []
        : this.airlines
            .find(inIds(airlineIds))
            .select('name')
            .lean<Named[]>()
            .exec(),
      hotelIds.length === 0
        ? []
        : this.hotels
            .find(inIds(hotelIds))
            .select('name')
            .lean<Named[]>()
            .exec(),
      flightIds.length === 0
        ? []
        : this.flights
            .find(inIds(flightIds))
            .select('departureAt arrivalAt')
            .lean<
              { _id: Types.ObjectId; departureAt: Date; arrivalAt: Date }[]
            >()
            .exec(),
    ]);
    return {
      users: byId(users),
      airlines: byId(airlines),
      hotels: byId(hotels),
      flights: byId(flights),
    };
  }
}

/** The distinct ids, in their first order. */
function unique(ids: Types.ObjectId[]): Types.ObjectId[] {
  return [...new Map(ids.map((id) => [id.toString(), id])).values()];
}
