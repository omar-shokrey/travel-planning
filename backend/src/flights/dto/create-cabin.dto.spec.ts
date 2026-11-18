import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import {
  CABIN_BAG_WEIGHT_MAX_KG,
  CABIN_FREE_BAGS_MAX,
  CABIN_PRICE_MAX,
  CABIN_SEATS_MAX,
} from '../flights.constants';
import { CabinClass } from '../models/cabin-class.enum';
import { CreateCabinDto } from './create-cabin.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: CreateCabinDto };

const validData = {
  cabin: 'economy',
  totalSeats: 180,
  price: 25000,
  freeBags: 1,
  maxBagKg: 23,
};

const parse = (body: unknown): Promise<CreateCabinDto> =>
  pipe.transform(body, metadata) as Promise<CreateCabinDto>;

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

describe('CreateCabinDto (FLT-04)', () => {
  it('accepts a valid cabin', async () => {
    const dto = await parse(validData);

    expect(dto).toBeInstanceOf(CreateCabinDto);
    expect({ ...dto }).toEqual(validData);
  });

  it.each(Object.values(CabinClass))('accepts the class %s', async (cabin) => {
    expect(await errorsOf({ ...validData, cabin })).toEqual([]);
  });

  it.each(['Economy', 'premium economy', 'premium', 'ECONOMY', '', 3])(
    'refuses the class %p, which is not in the fixed set',
    async (cabin) => {
      expect(await onlyField({ ...validData, cabin }, 'cabin')).toEqual([
        'cabin must be one of economy, premium_economy, business, first',
      ]);
    },
  );

  it('accepts the lowest values: 1 seat, a price of 1 cent, no free bag and 1 kg', async () => {
    expect(
      await errorsOf({
        ...validData,
        totalSeats: 1,
        price: 1,
        freeBags: 0,
        maxBagKg: 1,
      }),
    ).toEqual([]);
  });

  it('accepts the highest values, our limits', async () => {
    expect(
      await errorsOf({
        ...validData,
        totalSeats: CABIN_SEATS_MAX,
        price: CABIN_PRICE_MAX,
        freeBags: CABIN_FREE_BAGS_MAX,
        maxBagKg: CABIN_BAG_WEIGHT_MAX_KG,
      }),
    ).toEqual([]);
  });

  it.each([
    ['totalSeats', 0, 'totalSeats must be more than 0'],
    ['totalSeats', -5, 'totalSeats must be more than 0'],
    [
      'totalSeats',
      CABIN_SEATS_MAX + 1,
      `totalSeats must be at most ${CABIN_SEATS_MAX}`,
    ],
    ['totalSeats', 1.5, 'totalSeats must be a whole number'],
    ['price', 0, 'price must be more than 0'],
    ['price', -100, 'price must be more than 0'],
    ['price', CABIN_PRICE_MAX + 1, `price must be at most ${CABIN_PRICE_MAX}`],
    ['price', 1.5, 'price must be a whole number of minor units (cents)'],
    ['price', 249.99, 'price must be a whole number of minor units (cents)'],
    ['freeBags', -1, 'freeBags must be 0 or more'],
    [
      'freeBags',
      CABIN_FREE_BAGS_MAX + 1,
      `freeBags must be at most ${CABIN_FREE_BAGS_MAX}`,
    ],
    ['freeBags', 0.5, 'freeBags must be a whole number'],
    ['maxBagKg', 0, 'maxBagKg must be at least 1'],
    [
      'maxBagKg',
      CABIN_BAG_WEIGHT_MAX_KG + 1,
      `maxBagKg must be at most ${CABIN_BAG_WEIGHT_MAX_KG}`,
    ],
    ['maxBagKg', 22.5, 'maxBagKg must be a whole number of kg'],
  ])('refuses %s %p: %s', async (field, value, message) => {
    expect(await onlyField({ ...validData, [field]: value }, field)).toEqual([
      message,
    ]);
  });

  it('requires maxBagKg of 1 or more even when the cabin includes no free bag', async () => {
    expect(
      await onlyField({ ...validData, freeBags: 0, maxBagKg: 0 }, 'maxBagKg'),
    ).toEqual(['maxBagKg must be at least 1']);
  });

  it.each([
    [
      'totalSeats',
      [
        'totalSeats is required',
        `totalSeats must be at most ${CABIN_SEATS_MAX}`,
        'totalSeats must be more than 0',
        'totalSeats must be a whole number',
      ],
    ],
    [
      'price',
      [
        'price is required',
        `price must be at most ${CABIN_PRICE_MAX}`,
        'price must be more than 0',
        'price must be a whole number of minor units (cents)',
      ],
    ],
    [
      'freeBags',
      [
        'freeBags is required',
        `freeBags must be at most ${CABIN_FREE_BAGS_MAX}`,
        'freeBags must be 0 or more',
        'freeBags must be a whole number',
      ],
    ],
    [
      'maxBagKg',
      [
        'maxBagKg is required',
        `maxBagKg must be at most ${CABIN_BAG_WEIGHT_MAX_KG}`,
        'maxBagKg must be at least 1',
        'maxBagKg must be a whole number of kg',
      ],
    ],
    [
      'cabin',
      [
        'cabin is required',
        'cabin must be one of economy, premium_economy, business, first',
      ],
    ],
  ])(
    'requires %s: missing or null, it is reported as required first, then with its rules',
    async (field, messages) => {
      const { [field as keyof typeof validData]: _left, ...missing } =
        validData;
      expect(await onlyField(missing, field)).toEqual(messages);
      expect(await onlyField({ ...validData, [field]: null }, field)).toEqual(
        messages,
      );
    },
  );

  it('refuses a number sent as text', async () => {
    expect(
      await onlyField({ ...validData, totalSeats: '180' }, 'totalSeats'),
    ).toContain('totalSeats must be a whole number');
    expect(
      await onlyField({ ...validData, price: '25000' }, 'price'),
    ).toContain('price must be a whole number of minor units (cents)');
  });

  it.each([
    'bookedSeats',
    'heldSeats',
    'currency',
    'id',
    '_id',
    'availableSeats',
  ])('refuses %s, which only the server sets', async (field) => {
    expect(
      await onlyField(
        { ...validData, [field]: field === 'currency' ? 'EUR' : 0 },
        field,
      ),
    ).toEqual([`property ${field} should not exist`]);
  });

  it('refuses any other unknown field', async () => {
    expect(
      await onlyField({ ...validData, extraBagPrice: 5000 }, 'extraBagPrice'),
    ).toEqual(['property extraBagPrice should not exist']);
  });

  it('lists every broken field in one answer', async () => {
    const errors = await errorsOf({
      cabin: 'premium',
      totalSeats: 0,
      price: 0,
      freeBags: -1,
      maxBagKg: 0,
    });

    expect(errors.map((error) => error.field)).toEqual([
      'cabin',
      'totalSeats',
      'price',
      'freeBags',
      'maxBagKg',
    ]);
  });
});
