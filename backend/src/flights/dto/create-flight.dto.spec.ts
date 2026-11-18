import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CreateFlightDto } from './create-flight.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: CreateFlightDto };

const validData = {
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureLocal: '2027-06-15T14:30',
  arrivalLocal: '2027-06-15T18:30',
};

const parse = (body: unknown): Promise<CreateFlightDto> =>
  pipe.transform(body, metadata) as Promise<CreateFlightDto>;

/** The field errors the pipe answers with. Empty when the body is valid. */
async function errorsOf(body: unknown): Promise<FieldError[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

/** The messages of one field, or fails when another field is refused too. */
async function onlyField(body: unknown, field: string): Promise<string[]> {
  const errors = await errorsOf(body);
  expect(errors.map((error) => error.field)).toEqual([field]);
  return errors[0].messages;
}

describe('CreateFlightDto (FLT-03)', () => {
  it('accepts valid flight data', async () => {
    const dto = await parse(validData);

    expect(dto).toBeInstanceOf(CreateFlightDto);
    expect({ ...dto }).toEqual(validData);
  });

  it('trims and uppercases flight number and airport codes, and trims the local times', async () => {
    const dto = await parse({
      ...validData,
      flightNumber: ' ms123 ',
      departureAirport: ' cai ',
      arrivalAirport: ' jfk ',
      departureLocal: ' 2027-06-15T14:30 ',
    });

    expect(dto.flightNumber).toBe('MS123');
    expect(dto.departureAirport).toBe('CAI');
    expect(dto.arrivalAirport).toBe('JFK');
    expect(dto.departureLocal).toBe('2027-06-15T14:30');
  });

  it('accepts local date-times with seconds', async () => {
    expect(
      await errorsOf({
        ...validData,
        departureLocal: '2027-06-15T14:30:45',
        arrivalLocal: '2027-06-15T18:30:45',
      }),
    ).toEqual([]);
  });

  it.each(['A', 'ABCDEFGHIJK', 'MS-123', 'MS 12', 'MS12Ä'])(
    'rejects the flight number %p with its rule',
    async (flightNumber) => {
      expect(
        await onlyField({ ...validData, flightNumber }, 'flightNumber'),
      ).toContain('flightNumber must be 2 to 10 uppercase letters or digits');
    },
  );

  it.each([
    ['departureAirport', 'CA'],
    ['departureAirport', 'CAIR'],
    ['arrivalAirport', 'J1K'],
    ['arrivalAirport', 'JF-'],
  ])('rejects %s %p as not a 3-letter IATA code', async (field, value) => {
    expect(await onlyField({ ...validData, [field]: value }, field)).toContain(
      `${field} must be a 3-letter IATA airport code`,
    );
  });

  it.each([
    ['with Z', '2027-06-15T14:30Z'],
    ['with an offset', '2027-06-15T14:30+02:00'],
    ['with milliseconds', '2027-06-15T14:30:00.000'],
    ['without a time', '2027-06-15'],
    ['with a space', '2027-06-15 14:30'],
    ['at hour 24', '2027-06-15T24:00'],
    ['at minute 60', '2027-06-15T14:60'],
    ['that is not a date', 'not-a-date'],
  ])('rejects a local date-time %s', async (_label, departureLocal) => {
    expect(
      await onlyField({ ...validData, departureLocal }, 'departureLocal'),
    ).toContain(
      'departureLocal must be a local date-time YYYY-MM-DDTHH:mm (seconds optional) with no Z or offset',
    );
  });

  it.each(['2027-02-30T10:00', '2027-04-31T10:00', '2026-02-29T10:00'])(
    'rejects %p, a date that does not exist in the calendar',
    async (arrivalLocal) => {
      expect(
        await onlyField({ ...validData, arrivalLocal }, 'arrivalLocal'),
      ).toEqual(['arrivalLocal must be a real calendar date and time']);
    },
  );

  it.each(Object.keys(validData))(
    'rejects a body without %s, naming it',
    async (field) => {
      const body: Record<string, unknown> = { ...validData };
      delete body[field];

      expect(await onlyField(body, field)).toContain(
        `${field} must be a string`,
      );
    },
  );

  it.each(Object.keys(validData))('rejects %s sent as null', async (field) => {
    expect(await onlyField({ ...validData, [field]: null }, field)).toContain(
      `${field} must be a string`,
    );
  });

  it.each(Object.keys(validData))(
    'rejects %s sent as an empty text',
    async (field) => {
      expect(await onlyField({ ...validData, [field]: '  ' }, field)).toContain(
        `${field} must not be empty`,
      );
    },
  );

  it('rejects a number where a text is expected', async () => {
    expect(
      await onlyField({ ...validData, flightNumber: 123 }, 'flightNumber'),
    ).toContain('flightNumber must be a string');
  });

  it.each(['airlineId', 'status', 'departureAt', 'extra'])(
    'rejects %s, a field the client may not send',
    async (field) => {
      expect(await onlyField({ ...validData, [field]: 'x' }, field)).toEqual([
        `property ${field} should not exist`,
      ]);
    },
  );

  it('lists every invalid field at once', async () => {
    const errors = await errorsOf({
      flightNumber: 'M',
      departureAirport: 'CA',
      arrivalLocal: '2027-06-15T18:30Z',
      status: 'cancelled',
    });

    expect(errors.map((error) => error.field).sort()).toEqual([
      'arrivalAirport',
      'arrivalLocal',
      'departureAirport',
      'departureLocal',
      'flightNumber',
      'status',
    ]);
  });
});
