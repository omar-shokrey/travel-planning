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
import { UpdateCabinDto } from './update-cabin.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateCabinDto };

const parse = (body: unknown): Promise<UpdateCabinDto> =>
  pipe.transform(body, metadata) as Promise<UpdateCabinDto>;

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

describe('UpdateCabinDto (FLT-04, FLT-05)', () => {
  it('accepts all four fields', async () => {
    const body = { totalSeats: 200, price: 27500, freeBags: 2, maxBagKg: 32 };
    const dto = await parse(body);

    expect(dto).toBeInstanceOf(UpdateCabinDto);
    expect({ ...dto }).toEqual(body);
  });

  it.each([
    { totalSeats: 200 },
    { price: 27500 },
    { freeBags: 0 },
    { maxBagKg: 32 },
  ])(
    'accepts one field alone, %p: the others keep their value',
    async (body) => {
      expect(await errorsOf(body)).toEqual([]);
    },
  );

  it('leaves the empty-body rule to the service, which answers 400', async () => {
    // The pipe cannot tell "no field" from "every field left out"; the
    // service refuses it with "Send at least one of ...".
    expect(await errorsOf({})).toEqual([]);
  });

  it('accepts the limits', async () => {
    expect(
      await errorsOf({ totalSeats: 1, price: 1, freeBags: 0, maxBagKg: 1 }),
    ).toEqual([]);
    expect(
      await errorsOf({
        totalSeats: CABIN_SEATS_MAX,
        price: CABIN_PRICE_MAX,
        freeBags: CABIN_FREE_BAGS_MAX,
        maxBagKg: CABIN_BAG_WEIGHT_MAX_KG,
      }),
    ).toEqual([]);
  });

  it.each([
    ['totalSeats', 0, 'totalSeats must be more than 0'],
    [
      'totalSeats',
      CABIN_SEATS_MAX + 1,
      `totalSeats must be at most ${CABIN_SEATS_MAX}`,
    ],
    ['totalSeats', 2.5, 'totalSeats must be a whole number'],
    ['price', 0, 'price must be more than 0'],
    ['price', CABIN_PRICE_MAX + 1, `price must be at most ${CABIN_PRICE_MAX}`],
    ['price', 1.5, 'price must be a whole number of minor units (cents)'],
    ['freeBags', -1, 'freeBags must be 0 or more'],
    [
      'freeBags',
      CABIN_FREE_BAGS_MAX + 1,
      `freeBags must be at most ${CABIN_FREE_BAGS_MAX}`,
    ],
    ['maxBagKg', 0, 'maxBagKg must be at least 1'],
    [
      'maxBagKg',
      CABIN_BAG_WEIGHT_MAX_KG + 1,
      `maxBagKg must be at most ${CABIN_BAG_WEIGHT_MAX_KG}`,
    ],
    ['maxBagKg', 20.5, 'maxBagKg must be a whole number of kg'],
  ])('refuses %s %p: %s', async (field, value, message) => {
    expect(await onlyField({ [field]: value }, field)).toEqual([message]);
  });

  it.each([
    [
      'totalSeats',
      [
        `totalSeats must be at most ${CABIN_SEATS_MAX}`,
        'totalSeats must be more than 0',
        'totalSeats must be a whole number',
      ],
    ],
    [
      'price',
      [
        `price must be at most ${CABIN_PRICE_MAX}`,
        'price must be more than 0',
        'price must be a whole number of minor units (cents)',
      ],
    ],
    [
      'freeBags',
      [
        `freeBags must be at most ${CABIN_FREE_BAGS_MAX}`,
        'freeBags must be 0 or more',
        'freeBags must be a whole number',
      ],
    ],
    [
      'maxBagKg',
      [
        `maxBagKg must be at most ${CABIN_BAG_WEIGHT_MAX_KG}`,
        'maxBagKg must be at least 1',
        'maxBagKg must be a whole number of kg',
      ],
    ],
  ])(
    'refuses %s sent as null: no cabin field may be empty',
    async (field, messages) => {
      expect(await onlyField({ [field]: null }, field)).toEqual(messages);
    },
  );

  it('refuses a number sent as text', async () => {
    expect(await onlyField({ price: '27500' }, 'price')).toContain(
      'price must be a whole number of minor units (cents)',
    );
  });

  it('refuses the cabin class: it cannot be changed', async () => {
    expect(await onlyField({ cabin: 'business', price: 1 }, 'cabin')).toEqual([
      'property cabin should not exist',
    ]);
  });

  it.each([
    'bookedSeats',
    'heldSeats',
    'currency',
    'id',
    '_id',
    'availableSeats',
  ])('refuses %s, which only the server sets', async (field) => {
    expect(await onlyField({ price: 1, [field]: 0 }, field)).toEqual([
      `property ${field} should not exist`,
    ]);
  });
});
