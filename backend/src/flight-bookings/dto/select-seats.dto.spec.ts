import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { SelectSeatsDto } from './select-seats.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: SelectSeatsDto };

const parse = (body: unknown): Promise<SelectSeatsDto> =>
  pipe.transform(body, metadata) as Promise<SelectSeatsDto>;

async function errorsOf(body: unknown): Promise<FieldError[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

const valid = { seats: [{ passengerIndex: 0, seatNumber: '12C' }] };
const SEAT_FORMAT =
  'seatNumber must be a row number and a seat letter, for example 12C';

describe('SelectSeatsDto (FLT-28)', () => {
  it('accepts seats with no segment (a one-way booking) and with one', async () => {
    expect(await errorsOf(valid)).toEqual([]);
    expect(await errorsOf({ ...valid, segmentIndex: 1 })).toEqual([]);
    const dto = await parse({
      segmentIndex: 0,
      seats: [
        { passengerIndex: 0, seatNumber: '12C' },
        { passengerIndex: 1, seatNumber: '1060F' },
      ],
    });
    expect(dto.seats).toHaveLength(2);
    expect(dto.segmentIndex).toBe(0);
  });

  it.each([
    ['no seats', {}, 'seats', 'seats is required'],
    [
      'seats that are not a list',
      { seats: 'x' },
      'seats',
      'seats must be a list',
    ],
    [
      'an empty list',
      { seats: [] },
      'seats',
      'seats must have at least 1 seat',
    ],
    [
      'ten seats',
      {
        seats: Array.from({ length: 10 }, (_, i) => ({
          passengerIndex: i,
          seatNumber: `${i + 1}A`,
        })),
      },
      'seats',
      'seats must have at most 9 seats',
    ],
    [
      'a seat that is a list',
      { seats: [['1A']] },
      'seats',
      'Each seat must be an object',
    ],
    [
      'a passenger named twice',
      {
        seats: [
          { passengerIndex: 0, seatNumber: '1A' },
          { passengerIndex: 0, seatNumber: '1B' },
        ],
      },
      'seats',
      'seats must name each passenger at most once',
    ],
    [
      'a seat named twice',
      {
        seats: [
          { passengerIndex: 0, seatNumber: '1A' },
          { passengerIndex: 1, seatNumber: '1A' },
        ],
      },
      'seats',
      'seats must name each seat at most once',
    ],
    [
      'a null segment',
      { ...valid, segmentIndex: null },
      'segmentIndex',
      'segmentIndex must be a whole number',
    ],
    [
      'a decimal segment',
      { ...valid, segmentIndex: 0.5 },
      'segmentIndex',
      'segmentIndex must be a whole number',
    ],
    [
      'a negative segment',
      { ...valid, segmentIndex: -1 },
      'segmentIndex',
      'segmentIndex must be 0 or more',
    ],
    [
      'segment 2',
      { ...valid, segmentIndex: 2 },
      'segmentIndex',
      'segmentIndex must be at most 1',
    ],
    [
      'no passengerIndex',
      { seats: [{ seatNumber: '1A' }] },
      'seats.0.passengerIndex',
      'passengerIndex is required',
    ],
    [
      'a passengerIndex that is text',
      { seats: [{ passengerIndex: 'one', seatNumber: '1A' }] },
      'seats.0.passengerIndex',
      'passengerIndex must be a whole number',
    ],
    [
      'a negative passengerIndex',
      { seats: [{ passengerIndex: -1, seatNumber: '1A' }] },
      'seats.0.passengerIndex',
      'passengerIndex must be 0 or more',
    ],
    [
      'passengerIndex 18',
      { seats: [{ passengerIndex: 18, seatNumber: '1A' }] },
      'seats.0.passengerIndex',
      'passengerIndex must be at most 17',
    ],
    [
      'no seatNumber',
      { seats: [{ passengerIndex: 0 }] },
      'seats.0.seatNumber',
      'seatNumber is required',
    ],
    [
      'a seatNumber that is a number',
      { seats: [{ passengerIndex: 0, seatNumber: 12 }] },
      'seats.0.seatNumber',
      'seatNumber must be a text',
    ],
    [
      'a seatNumber without a letter',
      { seats: [{ passengerIndex: 0, seatNumber: '12' }] },
      'seats.0.seatNumber',
      SEAT_FORMAT,
    ],
    [
      'row 0',
      { seats: [{ passengerIndex: 0, seatNumber: '0A' }] },
      'seats.0.seatNumber',
      SEAT_FORMAT,
    ],
    [
      'a lower-case letter',
      { seats: [{ passengerIndex: 0, seatNumber: '12c' }] },
      'seats.0.seatNumber',
      SEAT_FORMAT,
    ],
  ])('refuses %s on %s', async (_label, body, field, message) => {
    const errors = await errorsOf(body);

    expect(errors.map((error) => error.field)).toContain(field);
    expect(errors.find((error) => error.field === field)?.messages).toContain(
      message,
    );
  });

  it.each(['cabin', 'userId', 'bookingId', 'flightId', 'status'])(
    'refuses %s, which the server sets',
    async (field) => {
      expect(await errorsOf({ ...valid, [field]: 'x' })).toEqual([
        { field, messages: [`property ${field} should not exist`] },
      ]);
    },
  );

  it('refuses an unknown field inside a seat', async () => {
    expect(
      await errorsOf({
        seats: [{ passengerIndex: 0, seatNumber: '1A', cabin: 'first' }],
      }),
    ).toEqual([
      { field: 'seats.0.cabin', messages: ['property cabin should not exist'] },
    ]);
  });
});
