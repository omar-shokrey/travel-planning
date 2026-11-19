import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { UpdateFlightDto } from './update-flight.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateFlightDto };

const parse = (body: unknown): Promise<UpdateFlightDto> =>
  pipe.transform(body, metadata) as Promise<UpdateFlightDto>;

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

describe('UpdateFlightDto (FLT-05)', () => {
  it('accepts all four fields', async () => {
    const body = {
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureLocal: '2027-06-15T16:30',
      arrivalLocal: '2027-06-15T20:30:45',
    };
    const dto = await parse(body);

    expect(dto).toBeInstanceOf(UpdateFlightDto);
    expect({ ...dto }).toEqual(body);
  });

  it.each([
    { departureAirport: 'CAI' },
    { arrivalAirport: 'JFK' },
    { departureLocal: '2027-06-15T16:30' },
    { arrivalLocal: '2027-06-15T20:30' },
  ])('accepts one field alone: %p', async (body) => {
    expect(await errorsOf(body)).toEqual([]);
  });

  it('accepts an empty body: the service answers it with 400', async () => {
    expect(await errorsOf({})).toEqual([]);
  });

  it('trims and uppercases the airport codes, and trims the times', async () => {
    const dto = await parse({
      departureAirport: ' cai ',
      arrivalAirport: 'jfk',
      departureLocal: ' 2027-06-15T16:30 ',
    });

    expect(dto.departureAirport).toBe('CAI');
    expect(dto.arrivalAirport).toBe('JFK');
    expect(dto.departureLocal).toBe('2027-06-15T16:30');
  });

  describe.each(['departureAirport', 'arrivalAirport'])('%s', (field) => {
    it.each(['CA', 'CAIR', 'C1I', 'C-I'])('refuses %p', async (code) => {
      expect(await onlyField({ [field]: code }, field)).toEqual([
        `${field} must be a 3-letter IATA airport code`,
      ]);
    });

    it('refuses null and an empty text', async () => {
      expect(await onlyField({ [field]: null }, field)).toContain(
        `${field} must be a string`,
      );
      expect(await onlyField({ [field]: '  ' }, field)).toContain(
        `${field} must not be empty`,
      );
    });

    it('refuses a number', async () => {
      expect(await onlyField({ [field]: 123 }, field)).toContain(
        `${field} must be a string`,
      );
    });
  });

  describe.each(['departureLocal', 'arrivalLocal'])('%s', (field) => {
    it.each([
      '2027-06-15T16:30Z',
      '2027-06-15T16:30+03:00',
      '2027-06-15 16:30',
      '2027-06-15',
      '2027-06-15T24:00',
      '15-06-2027T16:30',
    ])(
      'refuses %p: a local time has no Z, no offset and the T',
      async (value) => {
        expect(await onlyField({ [field]: value }, field)).toContain(
          `${field} must be a local date-time YYYY-MM-DDTHH:mm (seconds optional) with no Z or offset`,
        );
      },
    );

    it('refuses a date that does not exist', async () => {
      expect(await onlyField({ [field]: '2027-02-30T10:00' }, field)).toEqual([
        `${field} must be a real calendar date and time`,
      ]);
    });

    it('refuses null, an empty text and a number', async () => {
      expect(await onlyField({ [field]: null }, field)).toContain(
        `${field} must be a string`,
      );
      expect(await onlyField({ [field]: '' }, field)).toContain(
        `${field} must not be empty`,
      );
      expect(await onlyField({ [field]: 1781533800000 }, field)).toContain(
        `${field} must be a string`,
      );
    });
  });

  it.each([
    ['flightNumber', 'MS999'],
    ['airlineId', '6740f1c2a4b5c6d7e8f90123'],
    ['status', 'cancelled'],
    ['departureDateLocal', '2027-06-16'],
    ['departureAt', '2027-06-15T13:30:00.000Z'],
    ['arrivalAt', '2027-06-15T23:30:00.000Z'],
    ['cabins', []],
    ['bookedSeats', 0],
    ['heldSeats', 0],
    ['price', 30000],
    ['totalSeats', 100],
    ['id', '6740f1c2a4b5c6d7e8f90456'],
  ])(
    'refuses %s, which a moderator cannot change here',
    async (field, value) => {
      expect(
        await onlyField(
          { departureLocal: '2027-06-15T16:30', [field]: value },
          field,
        ),
      ).toEqual([`property ${field} should not exist`]);
    },
  );
});
