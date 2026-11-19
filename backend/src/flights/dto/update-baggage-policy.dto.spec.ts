import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { EXTRA_BAG_PRICE_MAX, MAX_EXTRA_BAGS_MAX } from '../flights.constants';
import { UpdateBaggagePolicyDto } from './update-baggage-policy.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: UpdateBaggagePolicyDto,
};

const valid = { extraBagPrice: 5000, maxExtraBags: 2 };

const parse = (body: unknown): Promise<UpdateBaggagePolicyDto> =>
  pipe.transform(body, metadata) as Promise<UpdateBaggagePolicyDto>;

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

describe('UpdateBaggagePolicyDto (FLT-08)', () => {
  it('accepts a rule and keeps the numbers as they are', async () => {
    await expect(parse(valid)).resolves.toEqual(valid);
  });

  it('accepts the boundaries: price 1 and the maximum, 0 extra bags and the maximum', async () => {
    expect(await errorsOf({ extraBagPrice: 1, maxExtraBags: 0 })).toEqual([]);
    expect(
      await errorsOf({
        extraBagPrice: EXTRA_BAG_PRICE_MAX,
        maxExtraBags: MAX_EXTRA_BAGS_MAX,
      }),
    ).toEqual([]);
  });

  describe('extraBagPrice: a whole number of cents above 0', () => {
    it.each([
      [0, 'extraBagPrice must be more than 0'],
      [-1, 'extraBagPrice must be more than 0'],
      [
        EXTRA_BAG_PRICE_MAX + 1,
        `extraBagPrice must be at most ${EXTRA_BAG_PRICE_MAX}`,
      ],
      [12.5, 'extraBagPrice must be a whole number of minor units (cents)'],
      ['5000', 'extraBagPrice must be a whole number of minor units (cents)'],
      [true, 'extraBagPrice must be a whole number of minor units (cents)'],
    ])('refuses %p', async (extraBagPrice, message) => {
      expect(
        await onlyField({ ...valid, extraBagPrice }, 'extraBagPrice'),
      ).toContain(message);
    });

    it.each([
      ['missing', undefined],
      ['null', null],
    ])(
      'refuses a %s price, saying it is required first',
      async (_label, value) => {
        const messages = await onlyField(
          { ...valid, extraBagPrice: value },
          'extraBagPrice',
        );
        expect(messages[0]).toBe('extraBagPrice is required');
      },
    );
  });

  describe('maxExtraBags: a whole number of 0 or more', () => {
    it.each([
      [-1, 'maxExtraBags must be 0 or more'],
      [
        MAX_EXTRA_BAGS_MAX + 1,
        `maxExtraBags must be at most ${MAX_EXTRA_BAGS_MAX}`,
      ],
      [1.5, 'maxExtraBags must be a whole number'],
      ['2', 'maxExtraBags must be a whole number'],
    ])('refuses %p', async (maxExtraBags, message) => {
      expect(
        await onlyField({ ...valid, maxExtraBags }, 'maxExtraBags'),
      ).toContain(message);
    });

    it.each([
      ['missing', undefined],
      ['null', null],
    ])(
      'refuses a %s maximum, saying it is required first',
      async (_label, value) => {
        const messages = await onlyField(
          { ...valid, maxExtraBags: value },
          'maxExtraBags',
        );
        expect(messages[0]).toBe('maxExtraBags is required');
      },
    );
  });

  it('refuses an empty body with both fields required', async () => {
    const errors = await errorsOf({});
    expect(errors.map((error) => error.field)).toEqual([
      'extraBagPrice',
      'maxExtraBags',
    ]);
  });

  it.each([
    'currency',
    'maxBagKg',
    'freeBags',
    'extraBagMaxKg',
    'cancellationTiers',
    'tiers',
    'active',
    'policy',
    '_id',
  ])('refuses the field %s, which this route does not set', async (field) => {
    const errors = await errorsOf({ ...valid, [field]: 1 });
    expect(errors).toEqual([
      { field, messages: [`property ${field} should not exist`] },
    ]);
  });
});
