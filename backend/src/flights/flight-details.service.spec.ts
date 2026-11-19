import { NotFoundException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import type { FlightResponsesService } from './flight-responses.service';
import { FlightDetailsService } from './flight-details.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from './flights.constants';
import type { Airline } from './models/airline.schema';
import { CabinClass } from './models/cabin-class.enum';
import { FlightStatus } from './models/flight-status.enum';
import type { Flight } from './models/flight.schema';

const NOW = new Date('2027-06-01T09:00:00.000Z');
const FLIGHT_ID = '6740f1c2a4b5c6d7e8f90456';
const AIRLINE_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');

const storedFlight = (fields: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(FLIGHT_ID),
  airlineId: AIRLINE_ID,
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureDateLocal: '2027-06-15',
  status: FlightStatus.Scheduled,
  cabins: [
    {
      _id: new Types.ObjectId(),
      cabin: CabinClass.Economy,
      totalSeats: 100,
      bookedSeats: 0,
      heldSeats: 0,
      price: 25000,
      freeBags: 1,
      maxBagKg: 23,
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
  ...fields,
});

const storedAirline = (fields: Record<string, unknown> = {}) => ({
  _id: AIRLINE_ID,
  name: 'EgyptAir',
  code: 'MS',
  logo: 'logo.png',
  active: true,
  policy: { cancellationTiers: [] },
  ...fields,
});

/** A lean query that answers `value`. */
const query = (value: unknown) => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
  return chain;
};

function setup(flight: unknown, airline: unknown = storedAirline()) {
  const flightQuery = query(flight);
  const airlineQuery = query(airline);
  const flights = {
    findById: jest.fn(() => flightQuery),
    // Every write a model has: the details page must call none of them.
    updateOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const airlines = { findById: jest.fn(() => airlineQuery) };
  const responses = {
    timeZonesOf: jest.fn().mockResolvedValue(
      new Map([
        ['CAI', 'Africa/Cairo'],
        ['JFK', 'America/New_York'],
      ]),
    ),
  };
  const service = new FlightDetailsService(
    flights as unknown as Model<Flight>,
    airlines as unknown as Model<Airline>,
    responses as unknown as FlightResponsesService,
  );
  return { service, flights, airlines, responses, airlineQuery };
}

describe('FlightDetailsService (FLT-17)', () => {
  it('reads the flight, its airline and the two time zones, and writes nothing', async () => {
    const { service, flights, airlines, responses, airlineQuery } =
      setup(storedFlight());

    const details = await service.findDetails(FLIGHT_ID, NOW);

    expect(flights.findById).toHaveBeenCalledWith(FLIGHT_ID);
    expect(airlines.findById).toHaveBeenCalledWith(AIRLINE_ID);
    expect(airlineQuery.select).toHaveBeenCalledWith(
      'name code logo active policy',
    );
    expect(responses.timeZonesOf).toHaveBeenCalledTimes(1);
    expect(responses.timeZonesOf).toHaveBeenCalledWith(['CAI', 'JFK']);
    expect(details).toMatchObject({
      id: FLIGHT_ID,
      airline: { name: 'EgyptAir' },
      departureLocal: '2027-06-15T14:30',
      durationMinutes: 660,
    });
    expect(flights.updateOne).not.toHaveBeenCalled();
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
    expect(flights.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown flight, before reading any airline', async () => {
    const { service, airlines } = setup(null);

    await expect(service.findDetails(FLIGHT_ID, NOW)).rejects.toThrow(
      new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE),
    );
    expect(airlines.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['a deactivated airline (ACC-15)', storedAirline({ active: false })],
    ['an airline that no longer exists', null],
  ])(
    'answers 404, like an unknown flight, for a flight of %s',
    async (_label, airline) => {
      const { service, responses } = setup(storedFlight(), airline);

      await expect(service.findDetails(FLIGHT_ID, NOW)).rejects.toThrow(
        new NotFoundException(FLIGHT_NOT_FOUND_MESSAGE),
      );
      expect(responses.timeZonesOf).not.toHaveBeenCalled();
    },
  );

  it('counts an airline stored without the active field as active', async () => {
    const { active: _active, ...withoutField } = storedAirline();
    const { service } = setup(storedFlight(), withoutField);

    await expect(service.findDetails(FLIGHT_ID, NOW)).resolves.toMatchObject({
      id: FLIGHT_ID,
    });
  });

  it.each([
    [
      'cancelled',
      storedFlight({ status: FlightStatus.Cancelled }),
      'cancelled',
    ],
    ['departed', storedFlight({ status: FlightStatus.Departed }), 'departed'],
    [
      'scheduled but past',
      storedFlight({ departureAt: new Date('2027-05-31T09:00:00.000Z') }),
      'departed',
    ],
  ])('shows a %s flight with its status', async (_label, flight, status) => {
    const { service } = setup(flight);

    await expect(service.findDetails(FLIGHT_ID, NOW)).resolves.toMatchObject({
      status,
    });
  });

  it('fails loudly when an airport of the flight has no time zone (broken reference data)', async () => {
    const { service, responses } = setup(storedFlight());
    responses.timeZonesOf.mockResolvedValueOnce(
      new Map([['CAI', 'Africa/Cairo']]),
    );

    await expect(service.findDetails(FLIGHT_ID, NOW)).rejects.toThrow(
      `An airport of flight ${FLIGHT_ID} has no time zone in the airports list`,
    );
  });
});
