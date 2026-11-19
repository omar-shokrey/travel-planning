import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Types, type Model } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { refundTiersOf } from './../src/flight-bookings/booking-refund';
import { FlightBookingStatus } from './../src/flight-bookings/enums/flight-booking-status.enum';
import { FlightBookingExpiryService } from './../src/flight-bookings/flight-booking-expiry.service';
import {
  INFANT_ON_RETURN_MESSAGE,
  RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE,
  RETURN_CABIN_WITHOUT_FLIGHT_MESSAGE,
  RETURN_FLIGHT_WITHOUT_CABIN_MESSAGE,
  RETURN_TOO_EARLY_MESSAGE,
  returnRouteMessage,
} from './../src/flight-bookings/flight-bookings.constants';
import { FlightBooking } from './../src/flight-bookings/models/flight-booking.schema';
import {
  FLIGHT_NOT_BOOKABLE_MESSAGE,
  NOT_ENOUGH_SEATS_MESSAGE,
} from './../src/flights/flight-seat-holds.service';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import {
  type Actor,
  createFlightFixture,
  type FlightFixture,
} from './support/flight-fixture';

/** The two airlines' policies (FLT-08, FLT-09): different tiers and bag prices. */
const OUT_POLICY = {
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ],
  extraBagPrice: 4500,
  maxExtraBags: 2,
};
const RET_POLICY = {
  cancellationTiers: [{ daysBefore: 3, refundPercent: 25 }],
  extraBagPrice: 4000,
  maxExtraBags: 1,
};
const OUT_PRICE = 10005;
const RET_PRICE = 20000;

interface PassengerBody {
  fullName: string;
  type: string;
  extraBags: { bags: number; weightKg: number } | null;
  returnExtraBags: { bags: number; weightKg: number } | null;
}
interface BookingBody {
  id: string;
  status: string;
  holdExpiresAt: string;
  fareTotal: number;
  baggageTotal: number;
  total: number;
  segments: {
    flightId: string;
    cabin: string;
    fare: number;
    seatsReserved: number;
  }[];
  passengerCounts: { adults: number; children: number; infants: number };
  passengers: PassengerBody[];
}
interface SummaryBody {
  flight: { id: string };
  cabin: string;
  passengers: { fare: number; baggageFee: number }[];
  returnTrip: {
    flight: { id: string; departureTimeZone: string };
    airline: { id: string };
    cabin: string;
    passengers: {
      fare: number;
      extraBags: { bags: number; weightKg: number } | null;
      baggageFee: number;
    }[];
    baggage: {
      freeBags: number;
      maxBagKg: number;
      extraBagPrice: number | null;
      maxExtraBags: number;
    };
    fareTotal: number;
    baggageTotal: number;
  } | null;
  fareTotal: number;
  baggageTotal: number;
  total: number;
}

describe('Round-trip booking (e2e, FLT-12(a))', () => {
  let fx: FlightFixture;
  let bookings: Model<FlightBooking>;
  /** Every booking this suite created, deleted one by one in afterAll. */
  const bookingIds = new Set<string>();

  let serial = 0;
  const passenger = (
    dateOfBirth = '1990-01-01',
    fields: Record<string, unknown> = {},
  ) => ({
    fullName: 'Round Trip Person',
    dateOfBirth,
    passportNumber: `FLT12${String((serial += 1)).padStart(6, '0')}`,
    ...fields,
  });

  /** In `days` from now, at `hourUtc`. */
  const daysAhead = (days: number, hourUtc = 8): Date =>
    DateTime.utc().startOf('day').plus({ days, hours: hourUtc }).toJSDate();

  /** An outbound flight (fixture airline, departure → arrival). */
  const outbound = (
    options: Parameters<FlightFixture['insertFlight']>[0] = {},
  ) =>
    fx.insertFlight({
      departureAt: daysAhead(40),
      ...options,
      cabins: options.cabins ?? [
        fx.storedCabin({ price: OUT_PRICE, freeBags: 1, maxBagKg: 23 }),
      ],
    });
  /** A return flight (the other airline, arrival → departure), a week later. */
  const inbound = (
    options: Parameters<FlightFixture['insertFlight']>[0] = {},
  ) =>
    fx.insertFlight({
      airlineId: fx.otherAirlineId,
      departureAirport: fx.airports.arrival,
      arrivalAirport: fx.airports.departure,
      departureAt: daysAhead(47, 15),
      ...options,
      cabins: options.cabins ?? [
        fx.storedCabin({ price: RET_PRICE, freeBags: 2, maxBagKg: 32 }),
        fx.storedCabin({ cabin: CabinClass.Business, price: 60000 }),
      ],
    });

  const body = (
    flightId: string,
    returnFlightId: string,
    fields: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    flightId,
    cabin: CabinClass.Economy,
    returnFlightId,
    returnCabin: CabinClass.Economy,
    passengers: [passenger()],
    ...fields,
  });

  const post = async (
    path: '/hold' | '',
    payload: Record<string, unknown>,
    actor: Actor | null = fx.user,
  ) => {
    const call = fx.http().post(`/api/flight-bookings${path}`);
    const response = await (
      actor ? call.set('Cookie', actor.cookie) : call
    ).send(payload);
    if (path === '/hold' && response.status === 201) {
      bookingIds.add((response.body as BookingBody).id);
    }
    return response;
  };
  const hold = (payload: Record<string, unknown>, actor?: Actor | null) =>
    post('/hold', payload, actor);
  const summarise = (payload: Record<string, unknown>) => post('', payload);

  const heldOf = async (flightId: string, cabin = CabinClass.Economy) => {
    const flight = await fx.flights.findById(flightId).lean().orFail().exec();
    const stored = flight.cabins.find((item) => item.cabin === cabin);
    if (!stored) throw new Error(`No ${cabin} cabin on ${flightId}`);
    return stored.heldSeats;
  };

  const errorsOf = (response: { body: unknown }) =>
    (response.body as { errors: { field: string; messages: string[] }[] })
      .errors;

  beforeAll(async () => {
    fx = await createFlightFixture('flt12b');
    bookings = fx.app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    await fx.airlines
      .findByIdAndUpdate(fx.airlineId, { $set: { policy: OUT_POLICY } })
      .exec();
    await fx.airlines
      .findByIdAndUpdate(fx.otherAirlineId, { $set: { policy: RET_POLICY } })
      .exec();
  });

  afterAll(async () => {
    if (!fx) return;
    try {
      for (const id of bookingIds) {
        await bookings.findByIdAndDelete(id).exec();
      }
    } finally {
      await fx.cleanup();
    }
  });

  describe('the hold: one booking, two segments', () => {
    let outId: string;
    let retId: string;
    let booking: BookingBody;

    beforeAll(async () => {
      outId = await outbound();
      retId = await inbound();
      const departure = (await fx.flights.findById(outId).lean().orFail())
        .departureDateLocal;
      const infantDob = DateTime.fromISO(departure)
        .minus({ months: 8 })
        .toISODate() as string;
      const response = await hold(
        body(outId, retId, {
          passengers: [
            passenger('1985-03-02', {
              extraBags: { bags: 2, weightKg: 40 },
              returnExtraBags: { bags: 1, weightKg: 30 },
            }),
            passenger(infantDob),
          ],
        }),
      );
      expect(response.status).toBe(201);
      booking = response.body as BookingBody;
    });

    it('answers 201 pending_payment with both flights as segments, outbound first', () => {
      expect(booking.status).toBe('pending_payment');
      expect(booking.segments).toEqual([
        {
          flightId: outId,
          cabin: 'economy',
          fare: OUT_PRICE,
          seatsReserved: 1,
        },
        {
          flightId: retId,
          cabin: 'economy',
          fare: RET_PRICE,
          seatsReserved: 1,
        },
      ]);
      expect(booking.passengerCounts).toEqual({
        adults: 1,
        children: 0,
        infants: 1,
      });
    });

    it('charges both flights once: the adult each fare, the infant 10% of each, the bags at each airline price', () => {
      // round(1000.5) = 1001 and 2000 for the infant.
      expect(booking.fareTotal).toBe(OUT_PRICE + 1001 + RET_PRICE + 2000);
      expect(booking.baggageTotal).toBe(2 * 4500 + 4000);
      expect(booking.total).toBe(booking.fareTotal + booking.baggageTotal);
      expect(booking.passengers[0]).toMatchObject({
        type: 'adult',
        extraBags: { bags: 2, weightKg: 40 },
        returnExtraBags: { bags: 1, weightKg: 30 },
      });
      expect(booking.passengers[1]).toMatchObject({
        type: 'infant',
        extraBags: null,
        returnExtraBags: null,
      });
    });

    it('holds the seats on both flights for one hold time', async () => {
      expect(await heldOf(outId)).toBe(1);
      expect(await heldOf(retId)).toBe(1);
      const stored = await bookings.findById(booking.id).lean().orFail();
      expect(stored.holdExpiresAt?.toISOString()).toBe(booking.holdExpiresAt);
      expect(stored.reference).toBeUndefined();
    });

    it('stores each airline policy in its segment, and refunds with the outbound tiers', async () => {
      const stored = await bookings.findById(booking.id).lean().orFail();

      expect(
        stored.segments.map((segment) => segment.airlineId.toString()),
      ).toEqual([fx.airlineId, fx.otherAirlineId]);
      expect(
        stored.segments.map((segment) =>
          segment.cancellationTiers.map(({ daysBefore, refundPercent }) => ({
            daysBefore,
            refundPercent,
          })),
        ),
      ).toEqual([OUT_POLICY.cancellationTiers, RET_POLICY.cancellationTiers]);
      expect(stored.segments[1]).toMatchObject({
        extraBagPrice: 4000,
        maxExtraBags: 1,
        freeBags: 2,
        maxBagKg: 32,
      });
      expect(stored.passengers[0].baggage).toEqual([
        expect.objectContaining({ segment: 0, bags: 2, weightKg: 40 }),
        expect.objectContaining({ segment: 1, bags: 1, weightKg: 30 }),
      ]);
      expect(refundTiersOf(stored)).toEqual(OUT_POLICY.cancellationTiers);
    });

    it('shows both segments in the policies before payment (PAY-02)', async () => {
      const response = await fx
        .http()
        .get(`/api/bookings/flight/${booking.id}/policies`)
        .set('Cookie', fx.user.cookie)
        .expect(200);

      expect(
        (
          response.body as {
            flight: {
              segments: { flightId: string; cancellationTiers: unknown[] }[];
            };
          }
        ).flight.segments.map(({ flightId, cancellationTiers }) => ({
          flightId,
          cancellationTiers,
        })),
      ).toEqual([
        { flightId: outId, cancellationTiers: OUT_POLICY.cancellationTiers },
        { flightId: retId, cancellationTiers: RET_POLICY.cancellationTiers },
      ]);
    });

    it('expires as one booking: the job releases the seats of both flights', async () => {
      await bookings
        .updateOne(
          { _id: new Types.ObjectId(booking.id) },
          { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
        )
        .exec();

      await fx.app.get(FlightBookingExpiryService).expireDueHolds(new Date());

      const stored = await bookings.findById(booking.id).lean().orFail();
      expect(stored.status).toBe(FlightBookingStatus.Expired);
      expect(await heldOf(outId)).toBe(0);
      expect(await heldOf(retId)).toBe(0);
    });
  });

  describe('the summary (FLT-21)', () => {
    it('shows the return flight and the totals the hold charges, and holds nothing', async () => {
      const outId = await outbound();
      const retId = await inbound();
      const payload = body(outId, retId, {
        returnCabin: CabinClass.Business,
        passengers: [
          passenger('1985-03-02', {
            returnExtraBags: { bags: 1, weightKg: 10 },
          }),
          passenger('1988-08-08'),
        ],
      });

      const response = await summarise(payload);

      expect(response.status).toBe(200);
      const summary = response.body as SummaryBody;
      expect(summary.flight.id).toBe(outId);
      expect(summary.returnTrip).toMatchObject({
        flight: { id: retId, departureTimeZone: 'America/New_York' },
        airline: { id: fx.otherAirlineId },
        cabin: 'business',
        passengers: [
          {
            fare: 60000,
            extraBags: { bags: 1, weightKg: 10 },
            baggageFee: 4000,
          },
          { fare: 60000, extraBags: null, baggageFee: 0 },
        ],
        baggage: { extraBagPrice: 4000, maxExtraBags: 1 },
        fareTotal: 120000,
        baggageTotal: 4000,
      });
      expect(summary.total).toBe(2 * OUT_PRICE + 120000 + 4000);
      expect(await heldOf(outId)).toBe(0);
      expect(await heldOf(retId, CabinClass.Business)).toBe(0);

      const held = await hold(payload);
      expect(held.status).toBe(201);
      expect((held.body as BookingBody).total).toBe(summary.total);
    });

    it('shows returnTrip null one-way', async () => {
      const outId = await outbound();

      const response = await summarise({
        flightId: outId,
        cabin: CabinClass.Economy,
        passengers: [passenger()],
      });

      expect(response.status).toBe(200);
      expect((response.body as SummaryBody).returnTrip).toBeNull();
    });
  });

  describe('nothing is held when the return flight is refused', () => {
    it('409 "Return flight: Not enough seats", and the outbound seats are released', async () => {
      const outId = await outbound();
      const retId = await inbound({
        cabins: [fx.storedCabin({ totalSeats: 2, bookedSeats: 2 })],
      });

      const response = await hold(body(outId, retId));

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        `Return flight: ${NOT_ENOUGH_SEATS_MESSAGE}`,
      );
      expect(await heldOf(outId)).toBe(0);
    });

    it('409 "Return flight: This flight can no longer be booked" for a cancelled return', async () => {
      const outId = await outbound();
      const retId = await inbound({ status: FlightStatus.Cancelled });

      const response = await hold(body(outId, retId));

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        `Return flight: ${FLIGHT_NOT_BOOKABLE_MESSAGE}`,
      );
      expect(await heldOf(outId)).toBe(0);
    });

    it('404 "Return flight: Flight not found" for an unknown return id', async () => {
      const outId = await outbound();

      const response = await hold(body(outId, new Types.ObjectId().toString()));

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Return flight: Flight not found');
      expect(await heldOf(outId)).toBe(0);
    });

    it('404 naming the return cabin the return flight lacks', async () => {
      const outId = await outbound();
      const retId = await inbound();

      const response = await hold(
        body(outId, retId, { returnCabin: CabinClass.First }),
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe(
        'Return flight: This flight has no first cabin',
      );
    });

    it('never holds more seats than the return cabin has, even at the same moment', async () => {
      const outId = await outbound();
      const retId = await inbound({
        cabins: [fx.storedCabin({ price: RET_PRICE, totalSeats: 2 })],
      });

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => hold(body(outId, retId))),
      );

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 201, 409, 409, 409]);
      // The refused requests gave their outbound seat back.
      expect(await heldOf(outId)).toBe(2);
      expect(await heldOf(retId)).toBe(2);
    });
  });

  describe('400: the round-trip rules', () => {
    it('refuses a return flight that does not fly the route back', async () => {
      const outId = await outbound();
      const sameWay = await outbound({ departureAt: daysAhead(47) });

      const response = await hold(body(outId, sameWay));

      expect(response.status).toBe(400);
      expect(errorsOf(response)).toEqual([
        {
          field: 'returnFlightId',
          messages: [
            returnRouteMessage(fx.airports.departure, fx.airports.arrival),
          ],
        },
      ]);
      expect(await heldOf(outId)).toBe(0);
    });

    it('refuses a return that leaves before the outbound flight arrives', async () => {
      const outId = await outbound({
        departureAt: daysAhead(40, 8),
        arrivalAt: daysAhead(40, 20),
      });
      const early = await inbound({ departureAt: daysAhead(40, 19) });

      const response = await hold(body(outId, early));

      expect(response.status).toBe(400);
      expect(errorsOf(response)).toEqual([
        { field: 'returnFlightId', messages: [RETURN_TOO_EARLY_MESSAGE] },
      ]);
    });

    it('refuses an infant who turns 2 before the return flight', async () => {
      const outId = await outbound();
      const retId = await inbound();
      const departure = (await fx.flights.findById(outId).lean().orFail())
        .departureDateLocal;
      // Second birthday three days after the outbound date, before the return.
      const dob = DateTime.fromISO(departure)
        .minus({ years: 2 })
        .plus({ days: 3 })
        .toISODate() as string;

      const response = await hold(
        body(outId, retId, { passengers: [passenger(), passenger(dob)] }),
      );

      expect(response.status).toBe(400);
      expect(errorsOf(response)).toEqual([
        {
          field: 'passengers.1.dateOfBirth',
          messages: [INFANT_ON_RETURN_MESSAGE],
        },
      ]);
    });

    it('checks the return bags against the return airline (at most 1, 32 kg)', async () => {
      const outId = await outbound();
      const retId = await inbound();

      const response = await hold(
        body(outId, retId, {
          passengers: [
            passenger('1980-01-01', {
              returnExtraBags: { bags: 2, weightKg: 40 },
            }),
            passenger('1981-01-01', {
              returnExtraBags: { bags: 1, weightKg: 33 },
            }),
          ],
        }),
      );

      expect(response.status).toBe(400);
      expect(errorsOf(response).map(({ field }) => field)).toEqual([
        'passengers.0.returnExtraBags.bags',
        'passengers.1.returnExtraBags.weightKg',
      ]);
    });

    it('needs returnFlightId and returnCabin together', async () => {
      const outId = await outbound();
      const retId = await inbound();

      const noCabin = await hold({
        ...body(outId, retId),
        returnCabin: undefined,
      });
      const noFlight = await hold({
        ...body(outId, retId),
        returnFlightId: undefined,
      });

      expect(errorsOf(noCabin)).toEqual([
        {
          field: 'returnCabin',
          messages: [RETURN_FLIGHT_WITHOUT_CABIN_MESSAGE],
        },
      ]);
      expect(errorsOf(noFlight)).toEqual([
        {
          field: 'returnFlightId',
          messages: [RETURN_CABIN_WITHOUT_FLIGHT_MESSAGE],
        },
      ]);
    });

    it('refuses returnExtraBags on a one-way booking', async () => {
      const outId = await outbound();

      const response = await hold({
        flightId: outId,
        cabin: CabinClass.Economy,
        passengers: [
          passenger('1980-01-01', {
            returnExtraBags: { bags: 1, weightKg: 5 },
          }),
        ],
      });

      expect(response.status).toBe(400);
      expect(errorsOf(response)).toEqual([
        {
          field: 'passengers.0.returnExtraBags',
          messages: [RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE],
        },
      ]);
      expect(await heldOf(outId)).toBe(0);
    });
  });

  it('is for registered users only: a guest gets 401', async () => {
    const outId = await outbound();
    const retId = await inbound();

    const response = await hold(body(outId, retId), null);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
  });

  it('documents the round trip in Swagger with a valid example', async () => {
    const response = await fx.http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/flight-bookings/hold'].post as {
      description: string;
      requestBody: {
        content: {
          'application/json': {
            examples: Record<string, { value: Record<string, unknown> }>;
          };
        };
      };
    };

    expect(operation.description).toContain('FLT-12(a)');
    expect(
      operation.requestBody.content['application/json'].examples.roundTrip
        .value,
    ).toMatchObject({
      returnFlightId: expect.any(String),
      returnCabin: 'business',
    });
  });
});
