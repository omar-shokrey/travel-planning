import { Mongoose, Types } from 'mongoose';
import { Airline } from './airline.schema';
import { FlightStatus } from './flight-status.enum';
import { Flight, FlightSchema } from './flight.schema';

const valid = () => ({
  airlineId: new Types.ObjectId(),
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureDateLocal: '2027-06-15',
  status: FlightStatus.Scheduled,
});

const model = () => new Mongoose().model(Flight.name, FlightSchema);

/** The validation errors of a flight, by path. Empty when it is valid. */
async function errorsOf(fields: Record<string, unknown>): Promise<string[]> {
  const FlightModel = model();
  const error = (await new FlightModel(fields)
    .validate()
    .catch((caught: unknown) => caught)) as
    { errors?: Record<string, unknown> } | undefined;
  return Object.keys(error?.errors ?? {}).sort();
}

describe('FlightSchema (FLT-03)', () => {
  it('accepts a complete flight', async () => {
    expect(await errorsOf(valid())).toEqual([]);
  });

  it('requires every field, and sets no default for any of them', async () => {
    expect(await errorsOf({})).toEqual([
      'airlineId',
      'arrivalAirport',
      'arrivalAt',
      'departureAirport',
      'departureAt',
      'departureDateLocal',
      'flightNumber',
      'status',
    ]);
  });

  it('stores the status as a text limited to the flight statuses', async () => {
    expect(FlightSchema.path('status').options).toMatchObject({
      type: String,
      required: true,
      enum: Object.values(FlightStatus),
    });
    expect(await errorsOf({ ...valid(), status: 'delayed' })).toEqual([
      'status',
    ]);
  });

  it('references the airline', () => {
    expect(FlightSchema.path('airlineId').options).toMatchObject({
      ref: Airline.name,
      required: true,
    });
  });

  it.each(['2027-6-15', '2027-06-15T00:00', '15-06-2027', '2027-13-01'])(
    'refuses %p as departureDateLocal (YYYY-MM-DD only)',
    async (departureDateLocal) => {
      expect(await errorsOf({ ...valid(), departureDateLocal })).toEqual([
        'departureDateLocal',
      ]);
    },
  );

  it('trims and uppercases the flight number and the airport codes', () => {
    const FlightModel = model();
    const flight = new FlightModel({
      ...valid(),
      flightNumber: ' ms123 ',
      departureAirport: ' cai ',
      arrivalAirport: 'jfk',
    });

    expect([
      flight.flightNumber,
      flight.departureAirport,
      flight.arrivalAirport,
    ]).toEqual(['MS123', 'CAI', 'JFK']);
  });

  it('has a unique index on airline, flight number and local departure date, and the search index', () => {
    const indexes = FlightSchema.indexes();

    expect(indexes).toContainEqual([
      { airlineId: 1, flightNumber: 1, departureDateLocal: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(indexes).toContainEqual([
      {
        departureAirport: 1,
        arrivalAirport: 1,
        departureDateLocal: 1,
        status: 1,
      },
      expect.not.objectContaining({ unique: true }),
    ]);
  });

  it('is stored in the flights collection with timestamps', () => {
    expect(model().collection.collectionName).toBe('flights');
    expect(FlightSchema.path('createdAt')).toBeDefined();
    expect(FlightSchema.path('updatedAt')).toBeDefined();
  });
});
