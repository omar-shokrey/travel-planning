import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { FLIGHT_SEARCH_PASSENGERS_MAX } from '../flights.constants';
import { SearchFlightsQueryDto } from './search-flights-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: SearchFlightsQueryDto,
};

/** A query string as Express gives it: every value is text. */
const valid = {
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureDate: '2027-06-15',
  passengers: '2',
};

const parse = (query: unknown): Promise<SearchFlightsQueryDto> =>
  pipe.transform(query, metadata) as Promise<SearchFlightsQueryDto>;

async function errorsOf(query: unknown): Promise<FieldError[]> {
  try {
    await parse(query);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

/** The messages of one field, or fails when another field is refused too. */
async function onlyField(query: unknown, field: string): Promise<string[]> {
  const errors = await errorsOf(query);
  expect(errors.map((error) => error.field)).toEqual([field]);
  return errors[0].messages;
}

const without = (field: keyof typeof valid) => {
  const query: Record<string, string> = { ...valid };
  delete query[field];
  return query;
};

describe('SearchFlightsQueryDto (FLT-11)', () => {
  it('reads a search: codes as given, passengers as a number, page 1 of 10', async () => {
    const dto = await parse(valid);

    expect(dto).toBeInstanceOf(SearchFlightsQueryDto);
    expect(dto).toMatchObject({
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureDate: '2027-06-15',
      passengers: 2,
      page: 1,
      limit: 10,
    });
    expect(dto.skip).toBe(0);
  });

  it('trims and uppercases the airport codes, and trims the date', async () => {
    const dto = await parse({
      ...valid,
      departureAirport: ' cai ',
      arrivalAirport: 'jFk',
      departureDate: ' 2027-06-15 ',
    });

    expect(dto.departureAirport).toBe('CAI');
    expect(dto.arrivalAirport).toBe('JFK');
    expect(dto.departureDate).toBe('2027-06-15');
  });

  it('reads a page and a limit', async () => {
    const dto = await parse({ ...valid, page: '2', limit: '1' });

    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(1);
    expect(dto.skip).toBe(1);
  });

  it.each([
    ['departureAirport', 'departureAirport is required'],
    ['arrivalAirport', 'arrivalAirport is required'],
    ['departureDate', 'departureDate is required'],
    ['passengers', 'passengers is required'],
  ] as const)(
    'refuses a search without %s, saying it is required first',
    async (field, message) => {
      const messages = await onlyField(without(field), field);
      expect(messages[0]).toBe(message);
    },
  );

  describe('the airport codes: 3 letters', () => {
    it.each(['CA', 'CAIR', 'C1I', 'CA-', ''])('refuses %p', async (code) => {
      expect(
        await onlyField(
          { ...valid, departureAirport: code },
          'departureAirport',
        ),
      ).toContain('departureAirport must be a 3-letter IATA airport code');
      expect(
        await onlyField({ ...valid, arrivalAirport: code }, 'arrivalAirport'),
      ).toContain('arrivalAirport must be a 3-letter IATA airport code');
    });

    it('refuses a code sent twice (a list, not a string)', async () => {
      expect(
        await onlyField(
          { ...valid, departureAirport: ['CAI', 'JFK'] },
          'departureAirport',
        ),
      ).toContain('departureAirport must be a string');
    });
  });

  describe('the departure date: a real calendar date, YYYY-MM-DD', () => {
    it.each(['2027-02-29', '2026-02-30', '2027-04-31'])(
      'refuses the date that does not exist %p',
      async (departureDate) => {
        expect(
          await onlyField({ ...valid, departureDate }, 'departureDate'),
        ).toEqual(['departureDate must be a real calendar date']);
      },
    );

    it.each([
      '2026-13-01',
      '2026-00-10',
      '15-06-2027',
      '2027/06/15',
      '2027-06-15T10:00',
      'tomorrow',
      '',
    ])('refuses the format %p', async (departureDate) => {
      expect(
        await onlyField({ ...valid, departureDate }, 'departureDate'),
      ).toContain('departureDate must be a date YYYY-MM-DD');
    });

    it('accepts 29 February of a leap year, and a date in the past (it just finds nothing)', async () => {
      expect(await errorsOf({ ...valid, departureDate: '2028-02-29' })).toEqual(
        [],
      );
      expect(await errorsOf({ ...valid, departureDate: '2020-01-01' })).toEqual(
        [],
      );
    });
  });

  describe(`passengers: a whole number from 1 to ${FLIGHT_SEARCH_PASSENGERS_MAX}`, () => {
    it('accepts 1 and the maximum', async () => {
      expect(await errorsOf({ ...valid, passengers: '1' })).toEqual([]);
      expect(
        await errorsOf({
          ...valid,
          passengers: String(FLIGHT_SEARCH_PASSENGERS_MAX),
        }),
      ).toEqual([]);
    });

    it.each([
      ['0', 'passengers must be at least 1'],
      ['-1', 'passengers must be at least 1'],
      [
        String(FLIGHT_SEARCH_PASSENGERS_MAX + 1),
        `passengers must be at most ${FLIGHT_SEARCH_PASSENGERS_MAX}`,
      ],
      ['1.5', 'passengers must be a whole number'],
      ['two', 'passengers must be a whole number'],
    ])('refuses %p', async (passengers, message) => {
      expect(await onlyField({ ...valid, passengers }, 'passengers')).toContain(
        message,
      );
    });
  });

  it.each(['page', 'limit'])('refuses a %s of 0', async (field) => {
    expect(
      (await errorsOf({ ...valid, [field]: '0' })).map((e) => e.field),
    ).toEqual([field]);
  });

  describe('skip: computed by the server, never sent', () => {
    // The shared PaginationQueryDto has skip as a getter only: without the
    // setter of this DTO, the transform would throw a TypeError, a 500.
    it('refuses a sent skip like any parameter the search does not have', async () => {
      expect(await errorsOf({ ...valid, skip: '5' })).toEqual([
        { field: 'skip', messages: ['property skip should not exist'] },
      ]);
    });

    it('reports a sent skip in the same answer as the other errors', async () => {
      const errors = await errorsOf({
        ...valid,
        skip: '5',
        cabin: 'economy',
        passengers: '0',
      });

      expect(errors.map((error) => error.field).sort()).toEqual([
        'cabin',
        'passengers',
        'skip',
      ]);
    });

    it('computes skip from page and limit, as the shared DTO does', async () => {
      const dto = await parse({ ...valid, page: '3', limit: '5' });

      expect(dto.skip).toBe(10);
      expect(Object.keys(dto)).not.toContain('skip');
    });
  });

  it.each(['returnDate', 'cabin', 'maxPrice', 'sort', 'airlineId', 'status'])(
    'refuses the parameter %s, which this search does not have',
    async (field) => {
      expect(await errorsOf({ ...valid, [field]: 'x' })).toEqual([
        { field, messages: [`property ${field} should not exist`] },
      ]);
    },
  );
});
