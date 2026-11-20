import { Types } from 'mongoose';
import { ProviderType } from '../../common/enums/provider-type.enum';
import { BookingType } from '../../payments/enums/booking-type.enum';
import {
  UNKNOWN_PROVIDER_NAME,
  UNKNOWN_USER_NAME,
} from '../admin-bookings.constants';
import {
  type AdminBookingLookups,
  type AdminFlightBookingSource,
  type AdminHotelBookingSource,
  toAdminBookingResponse,
} from './admin-booking.mapper';

const userId = new Types.ObjectId();
const airlineA = new Types.ObjectId();
const airlineB = new Types.ObjectId();
const hotelId = new Types.ObjectId();
const outbound = new Types.ObjectId();
const inbound = new Types.ObjectId();

const lookups: AdminBookingLookups = {
  users: new Map([
    [userId.toString(), { name: 'Sara Ahmed', email: 'sara@example.com' }],
  ]),
  airlines: new Map([
    [airlineA.toString(), { name: 'Nile Air' }],
    [airlineB.toString(), { name: 'Delta Wings' }],
  ]),
  hotels: new Map([[hotelId.toString(), { name: 'Nile View' }]]),
  flights: new Map([
    [
      outbound.toString(),
      {
        departureAt: new Date('2026-12-01T08:30:00.000Z'),
        arrivalAt: new Date('2026-12-01T11:00:00.000Z'),
      },
    ],
    [
      inbound.toString(),
      {
        departureAt: new Date('2026-12-08T12:00:00.000Z'),
        arrivalAt: new Date('2026-12-08T14:10:00.000Z'),
      },
    ],
  ]),
};

function flightBooking(
  overrides: Partial<AdminFlightBookingSource> = {},
): AdminFlightBookingSource {
  return {
    type: BookingType.Flight,
    _id: new Types.ObjectId(),
    reference: 'FB7K2QX9',
    userId,
    status: 'confirmed',
    currency: 'USD',
    total: 45000,
    createdAt: new Date('2026-11-05T11:00:00.000Z'),
    segments: [{ flightId: outbound, airlineId: airlineA }],
    ...overrides,
  };
}

function hotelBooking(
  overrides: Partial<AdminHotelBookingSource> = {},
): AdminHotelBookingSource {
  return {
    type: BookingType.Hotel,
    _id: new Types.ObjectId(),
    reference: 'HB3M8RT2',
    userId,
    hotelId,
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    status: 'completed',
    currency: 'USD',
    total: 36000,
    createdAt: new Date('2026-11-06T09:15:00.000Z'),
    ...overrides,
  };
}

const ROW_KEYS = [
  'amount',
  'createdAt',
  'currency',
  'dates',
  'id',
  'providers',
  'reference',
  'status',
  'type',
  'user',
];

describe('toAdminBookingResponse (ACC-17)', () => {
  it('maps a one-way flight booking', () => {
    const booking = flightBooking();

    expect(toAdminBookingResponse(booking, lookups)).toEqual({
      id: booking._id.toString(),
      type: 'flight',
      reference: 'FB7K2QX9',
      status: 'confirmed',
      user: {
        id: userId.toString(),
        name: 'Sara Ahmed',
        email: 'sara@example.com',
      },
      providers: [
        {
          type: ProviderType.Airline,
          id: airlineA.toString(),
          name: 'Nile Air',
        },
      ],
      dates: {
        start: '2026-12-01T08:30:00.000Z',
        end: '2026-12-01T11:00:00.000Z',
      },
      amount: 45000,
      currency: 'USD',
      createdAt: '2026-11-05T11:00:00.000Z',
    });
  });

  it('lists both airlines of a round trip once each, in the order of the segments', () => {
    const row = toAdminBookingResponse(
      flightBooking({
        segments: [
          { flightId: outbound, airlineId: airlineB },
          { flightId: inbound, airlineId: airlineA },
        ],
      }),
      lookups,
    );

    expect(row.providers).toEqual([
      {
        type: ProviderType.Airline,
        id: airlineB.toString(),
        name: 'Delta Wings',
      },
      { type: ProviderType.Airline, id: airlineA.toString(), name: 'Nile Air' },
    ]);
    expect(row.dates).toEqual({
      start: '2026-12-01T08:30:00.000Z',
      end: '2026-12-08T14:10:00.000Z',
    });
  });

  it('lists the airline of a round trip on one airline once', () => {
    const row = toAdminBookingResponse(
      flightBooking({
        segments: [
          { flightId: outbound, airlineId: airlineA },
          { flightId: inbound, airlineId: airlineA },
        ],
      }),
      lookups,
    );

    expect(row.providers).toEqual([
      { type: ProviderType.Airline, id: airlineA.toString(), name: 'Nile Air' },
    ]);
  });

  it('maps a hotel booking with its hotel and its days as YYYY-MM-DD', () => {
    const booking = hotelBooking();

    expect(toAdminBookingResponse(booking, lookups)).toEqual({
      id: booking._id.toString(),
      type: 'hotel',
      reference: 'HB3M8RT2',
      status: 'completed',
      user: {
        id: userId.toString(),
        name: 'Sara Ahmed',
        email: 'sara@example.com',
      },
      providers: [
        { type: ProviderType.Hotel, id: hotelId.toString(), name: 'Nile View' },
      ],
      dates: { start: '2026-12-01', end: '2026-12-04' },
      amount: 36000,
      currency: 'USD',
      createdAt: '2026-11-06T09:15:00.000Z',
    });
  });

  it('gives a pending booking a null reference', () => {
    expect(
      toAdminBookingResponse(
        flightBooking({ reference: undefined, status: 'pending_payment' }),
        lookups,
      ).reference,
    ).toBeNull();
    expect(
      toAdminBookingResponse(hotelBooking({ reference: null }), lookups)
        .reference,
    ).toBeNull();
  });

  it('gives null dates when a flight of the booking cannot be found', () => {
    const row = toAdminBookingResponse(
      flightBooking({
        segments: [
          { flightId: outbound, airlineId: airlineA },
          { flightId: new Types.ObjectId(), airlineId: airlineA },
        ],
      }),
      lookups,
    );

    expect(row.dates).toEqual({ start: null, end: null });
  });

  it('never throws for a user, airline or hotel that cannot be found', () => {
    const empty: AdminBookingLookups = {
      users: new Map(),
      airlines: new Map(),
      hotels: new Map(),
      flights: new Map(),
    };

    const flight = toAdminBookingResponse(flightBooking(), empty);
    const hotel = toAdminBookingResponse(hotelBooking(), empty);

    expect(flight.user).toEqual({
      id: userId.toString(),
      name: UNKNOWN_USER_NAME,
      email: null,
    });
    expect(flight.providers).toEqual([
      {
        type: ProviderType.Airline,
        id: airlineA.toString(),
        name: UNKNOWN_PROVIDER_NAME,
      },
    ]);
    expect(flight.dates).toEqual({ start: null, end: null });
    expect(hotel.providers).toEqual([
      {
        type: ProviderType.Hotel,
        id: hotelId.toString(),
        name: UNKNOWN_PROVIDER_NAME,
      },
    ]);
  });

  it('returns exactly the documented keys, so no passenger, payment or hold data can slip in', () => {
    const stored = {
      ...flightBooking(),
      passengers: [{ fullName: 'Sara', passportNumber: 'A123' }],
      fareTotal: 40000,
      baggageTotal: 5000,
      holdExpiresAt: new Date(),
      policyAcceptedAt: new Date(),
    } as AdminFlightBookingSource;
    const flight = toAdminBookingResponse(stored, lookups);
    const hotel = toAdminBookingResponse(
      {
        ...hotelBooking(),
        rooms: [],
        cancellationTiers: [],
      } as AdminHotelBookingSource,
      lookups,
    );

    for (const row of [flight, hotel]) {
      expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
      expect(Object.keys(row.user).sort()).toEqual(['email', 'id', 'name']);
      expect(Object.keys(row.dates).sort()).toEqual(['end', 'start']);
      expect(typeof row.id).toBe('string');
      expect(row.createdAt).toMatch(/Z$/);
    }
  });
});
