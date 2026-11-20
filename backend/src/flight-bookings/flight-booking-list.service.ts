import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model, type PipelineStage } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { FlightResponsesService } from '../flights/flight-responses.service';
import { Flight } from '../flights/models/flight.schema';
import { BookingType } from '../payments/enums/booking-type.enum';
import { RefundsService } from '../payments/refunds/refunds.service';
import type { FlightBookingDetailsResponseDto } from './dto/flight-booking-details-response.dto';
import type { FlightBookingListItemResponseDto } from './dto/flight-booking-list-item-response.dto';
import type { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import { FlightBookingGroup } from './enums/flight-booking-group.enum';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { BOOKING_NOT_FOUND_MESSAGE } from './flight-bookings.service';
import {
  type FlightsById,
  toFlightBookingDetails,
  toFlightBookingListItem,
} from './mappers/flight-booking-list.mapper';
import type { FlightBookingSource } from './mappers/flight-booking.mapper';
import { FlightBooking } from './models/flight-booking.schema';

/** How one group is chosen and ordered (FLT-25, see FlightBookingGroup). */
interface GroupRule {
  /** The statuses that can be in the group: the index prefix of the read. */
  statuses: FlightBookingStatus[];
  /** The rest of the rule, on `firstDepartureAt` and `lastDepartureAt`. */
  match: (now: Date) => Record<string, unknown>;
  sort: Record<string, 1 | -1>;
}

export const FLIGHT_BOOKING_GROUPS: Record<FlightBookingGroup, GroupRule> = {
  [FlightBookingGroup.Upcoming]: {
    statuses: [
      FlightBookingStatus.Confirmed,
      FlightBookingStatus.PendingPayment,
    ],
    match: (now) => ({
      $or: [
        { status: FlightBookingStatus.Confirmed },
        // A hold that has ended is expired, even before the job marks it.
        { holdExpiresAt: { $gt: now } },
      ],
      lastDepartureAt: { $gt: now },
    }),
    sort: { firstDepartureAt: 1, _id: 1 },
  },
  [FlightBookingGroup.Past]: {
    statuses: [FlightBookingStatus.Confirmed, FlightBookingStatus.Completed],
    match: (now) => ({
      $or: [
        { status: FlightBookingStatus.Completed },
        { lastDepartureAt: { $lte: now } },
      ],
    }),
    sort: { firstDepartureAt: -1, _id: -1 },
  },
  [FlightBookingGroup.Cancelled]: {
    statuses: [FlightBookingStatus.Cancelled],
    match: () => ({}),
    sort: { cancelledAt: -1, _id: -1 },
  },
};

/**
 * FLT-25: a registered user's own flight bookings, as three lists (upcoming,
 * past, cancelled) and the full details of one. Only the owner's bookings
 * are ever read (ACC-11): another user's booking is 404, like a missing one.
 */
@Injectable()
export class FlightBookingListService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    // Read only: the departure times that decide the group, and the flights shown.
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly flightResponses: FlightResponsesService,
    private readonly refunds: RefundsService,
  ) {}

  /**
   * One page of one group. A single aggregation reads the user's bookings of
   * the group's statuses (the (`userId`, `status`) index), the departure
   * times of their flights, keeps those of the group, orders them and counts
   * them. The flights of the page are then read once, with their local times.
   */
  async list(
    userId: string,
    query: ListFlightBookingsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResponse<FlightBookingListItemResponseDto>> {
    const rule = FLIGHT_BOOKING_GROUPS[query.group];
    const pipeline: PipelineStage[] = [
      {
        $match: {
          userId: new Types.ObjectId(userId),
          status: { $in: rule.statuses },
        },
      },
      {
        $lookup: {
          from: this.flights.collection.collectionName,
          localField: 'segments.flightId',
          foreignField: '_id',
          pipeline: [{ $project: { departureAt: 1 } }],
          as: 'legs',
        },
      },
      {
        $addFields: {
          firstDepartureAt: { $min: '$legs.departureAt' },
          lastDepartureAt: { $max: '$legs.departureAt' },
        },
      },
      { $match: rule.match(now) },
      { $sort: rule.sort },
      {
        $facet: {
          page: [
            { $skip: query.skip },
            { $limit: query.limit },
            { $project: { legs: 0, firstDepartureAt: 0, lastDepartureAt: 0 } },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];
    const [result] = await this.bookings
      .aggregate<{ page: FlightBookingSource[]; total: { count: number }[] }>(
        pipeline,
      )
      .exec();
    const page = result?.page ?? [];
    const total = result?.total[0]?.count ?? 0;
    const flights = await this.flightsOf(page, now);
    return paginate(
      page.map((booking) => toFlightBookingListItem(booking, flights)),
      total,
      query,
    );
  }

  /** The full details of one of the user's bookings; 404 for any other. */
  async details(
    id: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<FlightBookingDetailsResponseDto> {
    const booking = await this.bookings
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean<FlightBookingSource>()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    const [flights, refund] = await Promise.all([
      this.flightsOf([booking], now),
      this.refunds.findSummaryByBooking(BookingType.Flight, id),
    ]);
    return toFlightBookingDetails(booking, flights, refund);
  }

  /** The flights of these bookings, read in one query, by id. */
  private async flightsOf(
    bookings: readonly FlightBookingSource[],
    now: Date,
  ): Promise<FlightsById> {
    const ids = [
      ...new Set(
        bookings.flatMap((booking) =>
          booking.segments.map(({ flightId }) => flightId.toString()),
        ),
      ),
    ];
    if (ids.length === 0) {
      return new Map();
    }
    const stored = await this.flights
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const responses = await this.flightResponses.toResponses(stored, now);
    return new Map(responses.map((flight) => [flight.id, flight]));
  }
}
