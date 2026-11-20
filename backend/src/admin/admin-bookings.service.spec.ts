import { Types, type Model, type PipelineStage } from 'mongoose';
import { ProviderType } from '../common/enums/provider-type.enum';
import type { FlightBooking } from '../flight-bookings/models/flight-booking.schema';
import type { Airline } from '../flights/models/airline.schema';
import type { Flight } from '../flights/models/flight.schema';
import type { HotelBooking } from '../hotel-bookings/models/hotel-booking.schema';
import type { Hotel } from '../hotels/models/hotel.schema';
import { BookingType } from '../payments/enums/booking-type.enum';
import type { User } from '../users/models/user.schema';
import {
  ADMIN_FLIGHT_BOOKING_FIELDS,
  ADMIN_HOTEL_BOOKING_FIELDS,
  type AdminBookingPageFacet,
  AdminBookingsService,
} from './admin-bookings.service';
import {
  UNKNOWN_PROVIDER_NAME,
  UNKNOWN_USER_NAME,
} from './admin-bookings.constants';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';

/** A model whose `find().select().lean().exec()` returns `docs`. */
function findModel(docs: unknown[] = []) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(docs),
  };
  return { find: jest.fn().mockReturnValue(chain), chain };
}

/** A booking model that also aggregates to one `$facet` result. */
function bookingModel(facet: AdminBookingPageFacet, docs: unknown[] = []) {
  const model = findModel(docs);
  return {
    ...model,
    aggregate: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue([facet]) }),
    collection: { collectionName: 'hotel_bookings' },
  };
}

const empty: AdminBookingPageFacet = { items: [], total: [] };

const userId = new Types.ObjectId();
const airlineId = new Types.ObjectId();
const hotelId = new Types.ObjectId();
const flightId = new Types.ObjectId();
const flightBookingId = new Types.ObjectId();
const hotelBookingId = new Types.ObjectId();

const storedFlightBooking = {
  _id: flightBookingId,
  reference: 'FB7K2QX9',
  userId,
  status: 'confirmed',
  currency: 'USD',
  total: 45000,
  createdAt: new Date('2026-11-05T11:00:00.000Z'),
  segments: [{ flightId, airlineId }],
};
const storedHotelBooking = {
  _id: hotelBookingId,
  userId,
  hotelId,
  checkIn: '2026-12-01',
  checkOut: '2026-12-04',
  status: 'pending_payment',
  currency: 'USD',
  total: 36000,
  createdAt: new Date('2026-11-06T09:15:00.000Z'),
};

function setup(
  options: {
    flightFacet?: AdminBookingPageFacet;
    hotelFacet?: AdminBookingPageFacet;
    users?: unknown[];
    airlines?: unknown[];
    hotels?: unknown[];
    flights?: unknown[];
  } = {},
) {
  const flightBookings = bookingModel(options.flightFacet ?? empty, [
    storedFlightBooking,
  ]);
  const hotelBookings = bookingModel(options.hotelFacet ?? empty, [
    storedHotelBooking,
  ]);
  const users = findModel(
    options.users ?? [
      { _id: userId, name: 'Sara Ahmed', email: 'sara@example.com' },
    ],
  );
  const airlines = findModel(
    options.airlines ?? [{ _id: airlineId, name: 'Nile Air' }],
  );
  const hotels = findModel(
    options.hotels ?? [{ _id: hotelId, name: 'Nile View' }],
  );
  const flights = findModel(
    options.flights ?? [
      {
        _id: flightId,
        departureAt: new Date('2026-12-01T08:30:00.000Z'),
        arrivalAt: new Date('2026-12-01T11:00:00.000Z'),
      },
    ],
  );
  const service = new AdminBookingsService(
    flightBookings as unknown as Model<FlightBooking>,
    hotelBookings as unknown as Model<HotelBooking>,
    flights as unknown as Model<Flight>,
    airlines as unknown as Model<Airline>,
    hotels as unknown as Model<Hotel>,
    users as unknown as Model<User>,
  );
  return {
    service,
    flightBookings,
    hotelBookings,
    users,
    airlines,
    hotels,
    flights,
  };
}

function query(values: Partial<ListAdminBookingsQueryDto> = {}) {
  return Object.assign(new ListAdminBookingsQueryDto(), values);
}

/** The pipeline given to the first `aggregate` call of a model mock. */
const pipelineOf = (model: { aggregate: jest.Mock }): PipelineStage[] =>
  model.aggregate.mock.calls[0][0] as PipelineStage[];

/** Both rows of the merged page: the hotel booking is the newer one. */
const bothRows: AdminBookingPageFacet = {
  items: [
    {
      _id: hotelBookingId,
      createdAt: storedHotelBooking.createdAt,
      kind: BookingType.Hotel,
    },
    {
      _id: flightBookingId,
      createdAt: storedFlightBooking.createdAt,
      kind: BookingType.Flight,
    },
  ],
  total: [{ count: 12 }],
};

describe('AdminBookingsService (ACC-17)', () => {
  describe('phase (a): the page', () => {
    it('with type=flight aggregates only the flight bookings', async () => {
      const { service, flightBookings, hotelBookings } = setup();

      await service.list(query({ type: BookingType.Flight }));

      expect(flightBookings.aggregate).toHaveBeenCalledTimes(1);
      expect(hotelBookings.aggregate).not.toHaveBeenCalled();
      expect(JSON.stringify(pipelineOf(flightBookings))).not.toContain(
        '$unionWith',
      );
    });

    it('with type=hotel aggregates only the hotel bookings', async () => {
      const { service, flightBookings, hotelBookings } = setup();

      await service.list(query({ type: BookingType.Hotel }));

      expect(hotelBookings.aggregate).toHaveBeenCalledTimes(1);
      expect(flightBookings.aggregate).not.toHaveBeenCalled();
      expect(JSON.stringify(pipelineOf(hotelBookings))).not.toContain(
        '$unionWith',
      );
    });

    it('with no type starts from the flight bookings and adds the hotel bookings with $unionWith', async () => {
      const { service, flightBookings, hotelBookings } = setup();

      await service.list(query({ status: 'confirmed', page: 3, limit: 20 }));

      expect(hotelBookings.aggregate).not.toHaveBeenCalled();
      const match = { status: 'confirmed' };
      expect(pipelineOf(flightBookings)).toEqual([
        { $match: match },
        { $project: { _id: 1, createdAt: 1, kind: { $literal: 'flight' } } },
        {
          $unionWith: {
            coll: 'hotel_bookings',
            pipeline: [
              { $match: match },
              {
                $project: { _id: 1, createdAt: 1, kind: { $literal: 'hotel' } },
              },
            ],
          },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $facet: {
            items: [{ $skip: 40 }, { $limit: 20 }],
            total: [{ $count: 'count' }],
          },
        },
      ]);
    });
  });

  describe('buildMatch', () => {
    const { service } = setup();

    it('is empty without filters', () => {
      expect(service.buildMatch(query())).toEqual({});
    });

    it('turns from and to into the half-open UTC range [from, to + 1 day)', () => {
      expect(
        service.buildMatch(
          query({ status: 'expired', from: '2026-11-01', to: '2026-11-30' }),
        ),
      ).toEqual({
        status: 'expired',
        createdAt: {
          $gte: new Date('2026-11-01T00:00:00.000Z'),
          $lt: new Date('2026-12-01T00:00:00.000Z'),
        },
      });
    });

    it('takes from alone and to alone', () => {
      expect(service.buildMatch(query({ from: '2026-02-28' }))).toEqual({
        createdAt: { $gte: new Date('2026-02-28T00:00:00.000Z') },
      });
      expect(service.buildMatch(query({ to: '2026-02-28' }))).toEqual({
        createdAt: { $lt: new Date('2026-03-01T00:00:00.000Z') },
      });
    });
  });

  describe('phase (b): the rows', () => {
    it('returns items [] and the total without any other query when the page is empty', async () => {
      const {
        service,
        flightBookings,
        hotelBookings,
        users,
        airlines,
        hotels,
        flights,
      } = setup({ flightFacet: { items: [], total: [{ count: 3 }] } });

      expect(await service.list(query({ page: 5 }))).toEqual({
        items: [],
        meta: { page: 5, limit: 10, total: 3, totalPages: 1 },
      });
      for (const model of [
        flightBookings,
        hotelBookings,
        users,
        airlines,
        hotels,
        flights,
      ]) {
        expect(model.find).not.toHaveBeenCalled();
      }
    });

    it('gives total 0 when nothing matches', async () => {
      const { service } = setup();

      expect((await service.list(query())).meta.total).toBe(0);
    });

    it('keeps the order of phase (a) and maps every row', async () => {
      const { service } = setup({ flightFacet: bothRows });

      const page = await service.list(query());

      expect(page.meta).toEqual({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(page.items.map((row) => row.id)).toEqual([
        hotelBookingId.toString(),
        flightBookingId.toString(),
      ]);
      expect(page.items[0]).toMatchObject({
        type: 'hotel',
        reference: null,
        providers: [
          {
            type: ProviderType.Hotel,
            id: hotelId.toString(),
            name: 'Nile View',
          },
        ],
        dates: { start: '2026-12-01', end: '2026-12-04' },
      });
      expect(page.items[1]).toMatchObject({
        type: 'flight',
        reference: 'FB7K2QX9',
        user: {
          id: userId.toString(),
          name: 'Sara Ahmed',
          email: 'sara@example.com',
        },
        dates: {
          start: '2026-12-01T08:30:00.000Z',
          end: '2026-12-01T11:00:00.000Z',
        },
        amount: 45000,
      });
    });

    it('reads each collection with one $in query and never selects passengers', async () => {
      const {
        service,
        flightBookings,
        hotelBookings,
        users,
        airlines,
        hotels,
        flights,
      } = setup({ flightFacet: bothRows });

      await service.list(query());

      expect(flightBookings.find).toHaveBeenCalledTimes(1);
      expect(flightBookings.find).toHaveBeenCalledWith({
        _id: { $in: [flightBookingId] },
      });
      expect(flightBookings.chain.select).toHaveBeenCalledWith(
        ADMIN_FLIGHT_BOOKING_FIELDS,
      );
      expect(hotelBookings.find).toHaveBeenCalledWith({
        _id: { $in: [hotelBookingId] },
      });
      expect(hotelBookings.chain.select).toHaveBeenCalledWith(
        ADMIN_HOTEL_BOOKING_FIELDS,
      );
      for (const fields of [
        ADMIN_FLIGHT_BOOKING_FIELDS,
        ADMIN_HOTEL_BOOKING_FIELDS,
      ]) {
        expect(fields).not.toMatch(
          /passengers|passport|fareTotal|baggageTotal|holdExpiresAt|rooms|cancellationTiers|policyAcceptedAt/,
        );
      }
      // The user booked both: asked for once.
      expect(users.find).toHaveBeenCalledTimes(1);
      expect(users.find).toHaveBeenCalledWith({ _id: { $in: [userId] } });
      expect(users.chain.select).toHaveBeenCalledWith('name email');
      expect(airlines.find).toHaveBeenCalledTimes(1);
      expect(airlines.find).toHaveBeenCalledWith({ _id: { $in: [airlineId] } });
      expect(hotels.find).toHaveBeenCalledTimes(1);
      expect(hotels.find).toHaveBeenCalledWith({ _id: { $in: [hotelId] } });
      expect(flights.find).toHaveBeenCalledTimes(1);
      expect(flights.find).toHaveBeenCalledWith({ _id: { $in: [flightId] } });
      expect(flights.chain.select).toHaveBeenCalledWith(
        'departureAt arrivalAt',
      );
    });

    it('does not read the hotel side when the page has only flight bookings', async () => {
      const { service, hotelBookings, hotels } = setup({
        flightFacet: { items: [bothRows.items[1]], total: [{ count: 1 }] },
      });

      await service.list(query({ type: BookingType.Flight }));

      expect(hotelBookings.find).not.toHaveBeenCalled();
      expect(hotels.find).not.toHaveBeenCalled();
    });

    it('does not throw when the user, airline, hotel or flight cannot be found', async () => {
      const { service } = setup({
        flightFacet: bothRows,
        users: [],
        airlines: [],
        hotels: [],
        flights: [],
      });

      const [hotel, flight] = (await service.list(query())).items;

      expect(flight.user).toEqual({
        id: userId.toString(),
        name: UNKNOWN_USER_NAME,
        email: null,
      });
      expect(flight.providers[0].name).toBe(UNKNOWN_PROVIDER_NAME);
      expect(flight.dates).toEqual({ start: null, end: null });
      expect(hotel.providers[0].name).toBe(UNKNOWN_PROVIDER_NAME);
    });
  });
});
