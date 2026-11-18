import { Mongoose, Types } from 'mongoose';
import {
  CABIN_BAG_WEIGHT_MAX_KG,
  CABIN_FREE_BAGS_MAX,
  CABIN_PRICE_MAX,
  CABIN_SEATS_MAX,
} from '../flights.constants';
import { Airline } from './airline.schema';
import { CabinClass } from './cabin-class.enum';
import { FlightStatus } from './flight-status.enum';
import { Flight, FlightCabinSchema, FlightSchema } from './flight.schema';

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

  it('requires every field except the cabins, and sets no default for them', async () => {
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

const cabin = (fields: Record<string, unknown> = {}) => ({
  cabin: CabinClass.Economy,
  totalSeats: 180,
  price: 25000,
  freeBags: 1,
  maxBagKg: 23,
  ...fields,
});

describe('FlightSchema cabins (FLT-04)', () => {
  it('starts a flight with no cabins', () => {
    const flight = new (model())(valid());

    expect(flight.cabins).toHaveLength(0);
    expect(FlightSchema.path('cabins').options).toMatchObject({ default: [] });
  });

  it('gives each cabin its own id and starts its seat counters at 0', () => {
    const flight = new (model())({ ...valid(), cabins: [cabin()] });

    expect(flight.cabins[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(flight.cabins[0].bookedSeats).toBe(0);
    expect(flight.cabins[0].heldSeats).toBe(0);
  });

  it('accepts all four classes on one flight', async () => {
    expect(
      await errorsOf({
        ...valid(),
        cabins: Object.values(CabinClass).map((name) => cabin({ cabin: name })),
      }),
    ).toEqual([]);
  });

  it('stores the class as a text limited to the four cabin classes', async () => {
    expect(FlightCabinSchema.path('cabin').options).toMatchObject({
      type: String,
      required: true,
      enum: Object.values(CabinClass),
    });
    expect(
      await errorsOf({ ...valid(), cabins: [cabin({ cabin: 'premium' })] }),
    ).toEqual(['cabins.0.cabin']);
  });

  it('refuses the same class twice on one flight', async () => {
    expect(await errorsOf({ ...valid(), cabins: [cabin(), cabin()] })).toEqual([
      'cabins',
    ]);
  });

  it('requires the class, seats, price, free bags and bag weight', async () => {
    expect(await errorsOf({ ...valid(), cabins: [{}] })).toEqual([
      'cabins.0.cabin',
      'cabins.0.freeBags',
      'cabins.0.maxBagKg',
      'cabins.0.price',
      'cabins.0.totalSeats',
    ]);
  });

  it.each([
    ['totalSeats', 1.5],
    ['bookedSeats', 0.5],
    ['heldSeats', 2.25],
    ['price', 12.5],
    ['freeBags', 1.5],
    ['maxBagKg', 22.5],
  ])('refuses %s that is not a whole number (%p)', async (field, value) => {
    expect(
      await errorsOf({ ...valid(), cabins: [cabin({ [field]: value })] }),
    ).toEqual([`cabins.0.${field}`]);
  });

  it.each([
    ['totalSeats', 0],
    ['totalSeats', CABIN_SEATS_MAX + 1],
    ['bookedSeats', -1],
    ['heldSeats', -1],
    ['price', 0],
    ['price', CABIN_PRICE_MAX + 1],
    ['freeBags', -1],
    ['freeBags', CABIN_FREE_BAGS_MAX + 1],
    ['maxBagKg', 0],
    ['maxBagKg', CABIN_BAG_WEIGHT_MAX_KG + 1],
  ])('refuses %s %p, outside its limits', async (field, value) => {
    expect(
      await errorsOf({ ...valid(), cabins: [cabin({ [field]: value })] }),
    ).toEqual([`cabins.0.${field}`]);
  });

  it('accepts the limits themselves, and no free bag', async () => {
    expect(
      await errorsOf({
        ...valid(),
        cabins: [
          cabin({ totalSeats: 1, price: 1, freeBags: 0, maxBagKg: 1 }),
          cabin({
            cabin: CabinClass.First,
            totalSeats: CABIN_SEATS_MAX,
            price: CABIN_PRICE_MAX,
            freeBags: CABIN_FREE_BAGS_MAX,
            maxBagKg: CABIN_BAG_WEIGHT_MAX_KG,
          }),
        ],
      }),
    ).toEqual([]);
  });
});
