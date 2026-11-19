import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import {
  HoldFlightBookingDto,
  PassengerCountsDto,
} from './hold-flight-booking.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: HoldFlightBookingDto,
};

const body = (fields: Record<string, unknown> = {}) => ({
  flightId: '6740f1c2a4b5c6d7e8f90456',
  cabin: 'economy',
  passengers: { adults: 2, children: 0, infants: 1 },
  ...fields,
});

const passengers = (fields: Record<string, unknown>) =>
  body({ passengers: { adults: 2, children: 0, infants: 0, ...fields } });

const parse = (input: unknown): Promise<HoldFlightBookingDto> =>
  pipe.transform(input, metadata) as Promise<HoldFlightBookingDto>;

/** The field errors the pipe answers with. Empty when the body is valid. */
async function errorsOf(input: unknown): Promise<FieldError[]> {
  try {
    await parse(input);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

/** The messages of one field, or fails when another field is refused too. */
async function onlyField(input: unknown, field: string): Promise<string[]> {
  const errors = await errorsOf(input);
  expect(errors.map((error) => error.field)).toEqual([field]);
  return errors[0].messages;
}

describe('HoldFlightBookingDto (FLT-22)', () => {
  it('accepts a valid body and builds the nested passengers', async () => {
    const dto = await parse(body());

    expect(dto).toBeInstanceOf(HoldFlightBookingDto);
    expect(dto.passengers).toBeInstanceOf(PassengerCountsDto);
    expect(dto).toEqual({
      flightId: '6740f1c2a4b5c6d7e8f90456',
      cabin: CabinClass.Economy,
      passengers: { adults: 2, children: 0, infants: 1 },
    });
  });

  it('accepts 9 seats (adults and children) and as many infants as adults', async () => {
    expect(
      await errorsOf(passengers({ adults: 5, children: 4, infants: 5 })),
    ).toEqual([]);
    expect(
      await errorsOf(passengers({ adults: 9, children: 0, infants: 9 })),
    ).toEqual([]);
  });

  it('requires every field', async () => {
    expect((await errorsOf({})).map((error) => error.field)).toEqual([
      'flightId',
      'cabin',
      'passengers',
    ]);
    expect(
      (await errorsOf(body({ passengers: {} }))).map((error) => error.field),
    ).toEqual([
      'passengers.adults',
      'passengers.children',
      'passengers.infants',
    ]);
  });

  it('refuses a bad flightId', async () => {
    expect(await onlyField(body({ flightId: 'abc' }), 'flightId')).toEqual([
      'flightId must be a valid id',
    ]);
  });

  it('refuses an unknown cabin', async () => {
    expect(await onlyField(body({ cabin: 'deluxe' }), 'cabin')).toEqual([
      'cabin must be one of: economy, premium_economy, business, first',
    ]);
  });

  it('refuses a booking with no adult (FLT-12)', async () => {
    expect(
      await onlyField(
        passengers({ adults: 0, children: 1 }),
        'passengers.adults',
      ),
    ).toEqual(['A booking needs at least one adult']);
  });

  it('refuses more infants than adults (FLT-12)', async () => {
    expect(
      await onlyField(
        passengers({ adults: 1, infants: 2 }),
        'passengers.infants',
      ),
    ).toEqual(['A booking cannot have more infants than adults']);
  });

  it('refuses more than 9 seats, adults and children together', async () => {
    expect(
      await onlyField(
        passengers({ adults: 5, children: 5 }),
        'passengers.children',
      ),
    ).toEqual(['A booking has at most 9 seats (adults and children)']);
    expect(
      await onlyField(passengers({ adults: 10 }), 'passengers.adults'),
    ).toEqual(['adults must be at most 9']);
  });

  it('refuses counts that are not whole numbers', async () => {
    expect(
      await onlyField(passengers({ children: 1.5 }), 'passengers.children'),
    ).toContain('children must be a whole number');
    expect(
      await onlyField(passengers({ infants: '1' }), 'passengers.infants'),
    ).toContain('infants must be a whole number');
  });

  it('refuses passengers sent as a list or as null', async () => {
    expect(await onlyField(body({ passengers: [] }), 'passengers')).toEqual([
      'passengers must be an object',
    ]);
    expect(await onlyField(body({ passengers: null }), 'passengers')).toEqual([
      'passengers is required',
      'passengers must be an object',
    ]);
  });

  it.each([
    ['price', 1],
    ['status', 'confirmed'],
    ['holdExpiresAt', '2027-01-01T00:00:00.000Z'],
    ['userId', '6740f1c2a4b5c6d7e8f90123'],
    ['reference', 'ABC123'],
    ['seats', 2],
    ['total', 100],
  ])('refuses the server-controlled field %s', async (field, value) => {
    const errors = await errorsOf(body({ [field]: value }));

    expect(errors).toEqual([
      { field, messages: [`property ${field} should not exist`] },
    ]);
  });

  it('refuses an unknown field inside passengers', async () => {
    expect(
      await onlyField(passengers({ seats: 3 }), 'passengers.seats'),
    ).toEqual(['property seats should not exist']);
  });
});
