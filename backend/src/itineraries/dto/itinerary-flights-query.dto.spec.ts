import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ItineraryTripType } from '../enums/itinerary-trip-type.enum';
import { ItineraryFlightsQueryDto } from './itinerary-flights-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const asQuery: ArgumentMetadata = {
  type: 'query',
  metatype: ItineraryFlightsQueryDto,
};

const VALID = { originAirport: 'CAI', passengers: '2' };

const parse = (query: object) =>
  pipe.transform(query, asQuery) as Promise<ItineraryFlightsQueryDto>;

/** The field errors of the 400 for `query`; empty when it is valid. */
const errorsOf = async (query: object): Promise<FieldError[]> => {
  const error = await parse(query).then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error === null) return [];
  expect(error).toBeInstanceOf(BadRequestException);
  return (
    (error as BadRequestException).getResponse() as { errors: FieldError[] }
  ).errors;
};

/** The messages of one field; fails when another field is refused too. */
const onlyField = async (query: object, field: string): Promise<string[]> => {
  const errors = await errorsOf(query);
  expect(errors.map((entry) => entry.field)).toEqual([field]);
  return errors[0].messages;
};

describe('ItineraryFlightsQueryDto (ITN-26)', () => {
  it('needs only the origin and the passengers; the rest has defaults', async () => {
    const dto = await parse(VALID);

    expect(dto).toMatchObject({
      originAirport: 'CAI',
      passengers: 2,
      tripType: ItineraryTripType.RoundTrip,
      sortBy: 'departureTime',
      sortOrder: 'asc',
      page: 1,
      limit: 10,
    });
    expect(dto.departureDate).toBeUndefined();
    expect(dto.returnDate).toBeUndefined();
  });

  it('trims and uppercases the origin', async () => {
    expect(
      (await parse({ ...VALID, originAirport: ' cai ' })).originAirport,
    ).toBe('CAI');
  });

  it.each([
    [{ passengers: '2' }, 'originAirport is required'],
    [
      { ...VALID, originAirport: 'CA' },
      'originAirport must be a 3-letter IATA airport code',
    ],
    [
      { ...VALID, originAirport: 'C4I' },
      'originAirport must be a 3-letter IATA airport code',
    ],
  ])('refuses the origin of %p', async (query, message) => {
    expect(await onlyField(query, 'originAirport')).toContain(message);
  });

  it('refuses an origin sent twice (a list), untouched by the trimming', async () => {
    expect(
      await onlyField(
        { ...VALID, originAirport: ['CAI', 'JFK'] },
        'originAirport',
      ),
    ).toContain('originAirport must be a string');
  });

  it('keeps the passengers rule of flight search (1 to 9)', async () => {
    expect(await onlyField({ originAirport: 'CAI' }, 'passengers')).toContain(
      'passengers is required',
    );
    expect(
      await onlyField({ ...VALID, passengers: '10' }, 'passengers'),
    ).toEqual(['passengers must be at most 9']);
  });

  it.each(['one_way', 'round_trip'])(
    'accepts tripType %s',
    async (tripType) => {
      expect((await parse({ ...VALID, tripType })).tripType).toBe(tripType);
    },
  );

  it.each(['oneWay', 'ROUND_TRIP', ''])(
    'refuses tripType %p',
    async (tripType) => {
      expect(await onlyField({ ...VALID, tripType }, 'tripType')).toEqual([
        'tripType must be one of: one_way, round_trip',
      ]);
    },
  );

  describe.each(['departureDate', 'returnDate'])('%s, optional', (field) => {
    it('accepts a real date, trimmed', async () => {
      const dto = await parse({ ...VALID, [field]: ' 2028-02-29 ' });

      expect(dto[field as 'departureDate' | 'returnDate']).toBe('2028-02-29');
    });

    it('refuses a date that does not exist', async () => {
      expect(
        await onlyField({ ...VALID, [field]: '2027-02-29' }, field),
      ).toEqual([`${field} must be a real calendar date`]);
    });

    it.each(['15-06-2027', '2027/06/15', 'tomorrow', ''])(
      'refuses the format %p',
      async (value) => {
        expect(await onlyField({ ...VALID, [field]: value }, field)).toContain(
          `${field} must be a date YYYY-MM-DD`,
        );
      },
    );

    it('refuses a repeated parameter', async () => {
      expect(
        await onlyField(
          { ...VALID, [field]: ['2027-06-15', '2027-06-16'] },
          field,
        ),
      ).toContain(`${field} must be a string`);
    });
  });

  it('keeps the cabin, price and order rules of flight search', async () => {
    expect(
      await errorsOf({
        ...VALID,
        cabin: 'business',
        minPrice: '0',
        maxPrice: '5000',
        sortBy: 'price',
        sortOrder: 'desc',
      }),
    ).toEqual([]);
    expect(await onlyField({ ...VALID, cabin: 'coach' }, 'cabin')).toEqual([
      'cabin must be one of: economy, premium_economy, business, first',
    ]);
    expect(
      await onlyField({ ...VALID, minPrice: '1.5' }, 'minPrice'),
    ).toContain('minPrice must be a whole number of minor units (cents)');
  });

  it.each([
    'departureAirport',
    'arrivalAirport',
    'destinationAirport',
    'cityId',
    'skip',
  ])('refuses %s: the destination comes from the itinerary', async (field) => {
    expect(await onlyField({ ...VALID, [field]: 'x' }, field)).toEqual([
      `property ${field} should not exist`,
    ]);
  });

  it('has no Swagger example on the optional dates and trip type, so "Try it out" keeps the itinerary\'s', () => {
    const property = (name: string) =>
      Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES,
        ItineraryFlightsQueryDto.prototype,
        name,
      ) as { example?: unknown; required?: boolean };

    for (const name of ['departureDate', 'returnDate', 'tripType']) {
      expect(property(name).required).toBe(false);
      expect(property(name).example).toBeUndefined();
    }
    expect(property('originAirport').required).not.toBe(false);
  });
});
