import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CANCELLATION_TIERS_MAX_COUNT } from '../flights.constants';
import {
  CancellationTierDto,
  UpdateCancellationPolicyDto,
} from './update-cancellation-policy.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: UpdateCancellationPolicyDto,
};

const valid = {
  tiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 0, refundPercent: 0 },
  ],
};

const parse = (body: unknown): Promise<UpdateCancellationPolicyDto> =>
  pipe.transform(body, metadata) as Promise<UpdateCancellationPolicyDto>;

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

const invalidFields = async (body: unknown): Promise<string[]> =>
  (await errorsOf(body)).map(({ field }) => field).sort();

const tiersWith = (tier: Record<string, unknown>) => ({
  tiers: [{ daysBefore: 30, refundPercent: 100 }, tier],
});

describe('UpdateCancellationPolicyDto (FLT-09)', () => {
  it('accepts a list of tiers and keeps them as tier objects', async () => {
    const dto = await parse(valid);

    expect(dto).toBeInstanceOf(UpdateCancellationPolicyDto);
    expect(dto.tiers).toEqual(valid.tiers);
    for (const tier of dto.tiers) {
      expect(tier).toBeInstanceOf(CancellationTierDto);
    }
  });

  it('accepts an empty list: no refund at all', async () => {
    expect(await invalidFields({ tiers: [] })).toEqual([]);
  });

  it(`accepts ${CANCELLATION_TIERS_MAX_COUNT} tiers and refuses one more`, async () => {
    const many = (count: number) => ({
      tiers: Array.from({ length: count }, (_, index) => ({
        daysBefore: index,
        refundPercent: 50,
      })),
    });

    expect(await invalidFields(many(CANCELLATION_TIERS_MAX_COUNT))).toEqual([]);
    expect(await invalidFields(many(CANCELLATION_TIERS_MAX_COUNT + 1))).toEqual(
      ['tiers'],
    );
  });

  it('refuses two tiers with the same threshold and names the threshold', async () => {
    const errors = await errorsOf({
      tiers: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 1, refundPercent: 25 },
      ],
    });

    expect(errors).toEqual([
      {
        field: 'tiers',
        messages: [
          'Each tier must have a different daysBefore: 7 appears more than once',
        ],
      },
    ]);
  });

  it.each([
    [
      'a negative threshold',
      { daysBefore: -1, refundPercent: 10 },
      'daysBefore',
    ],
    [
      'a fractional threshold',
      { daysBefore: 1.5, refundPercent: 10 },
      'daysBefore',
    ],
    [
      'a threshold sent as text',
      { daysBefore: '7', refundPercent: 10 },
      'daysBefore',
    ],
    ['no threshold', { refundPercent: 10 }, 'daysBefore'],
    [
      'a refund above 100',
      { daysBefore: 7, refundPercent: 101 },
      'refundPercent',
    ],
    [
      'a negative refund',
      { daysBefore: 7, refundPercent: -5 },
      'refundPercent',
    ],
    [
      'a fractional refund',
      { daysBefore: 7, refundPercent: 12.5 },
      'refundPercent',
    ],
    [
      'a refund sent as text',
      { daysBefore: 7, refundPercent: '50' },
      'refundPercent',
    ],
    ['no refund', { daysBefore: 7 }, 'refundPercent'],
  ])('refuses %s', async (_label, tier, field) => {
    expect(await invalidFields(tiersWith(tier))).toEqual([`tiers.1.${field}`]);
  });

  it('refuses a field a tier may not have', async () => {
    expect(
      await invalidFields(
        tiersWith({ daysBefore: 7, refundPercent: 10, currency: 'USD' }),
      ),
    ).toEqual(['tiers.1.currency']);
  });

  it.each([
    [
      'no tiers',
      {},
      ['tiers is required (send [] for no refund)', 'tiers must be a list'],
    ],
    [
      'tiers sent as null',
      { tiers: null },
      [
        'tiers is required (send [] for no refund)',
        'tiers must be a list',
        // class-validator's own message from ValidateNested.
        'each value in nested property tiers must be either object or array',
      ],
    ],
    [
      'tiers that are not a list',
      { tiers: { daysBefore: 7, refundPercent: 10 } },
      ['tiers must be a list'],
    ],
  ])(
    'refuses %s with only the messages that are true',
    async (_label, body, messages) => {
      expect(await errorsOf(body)).toEqual([{ field: 'tiers', messages }]);
    },
  );

  it.each([
    ['a number', [5]],
    ['null', [null]],
    ['an empty list', [[]]],
    ['a list of tiers', [[{ daysBefore: 1, refundPercent: 1 }]]],
  ])('refuses a tier sent as %s', async (_label, tiers) => {
    const errors = await errorsOf({ tiers });

    expect(errors).toContainEqual({
      field: 'tiers',
      messages: ['Each tier must be an object'],
    });
  });

  it('reports a missing threshold on its tier, not as a repeated one', async () => {
    const errors = await errorsOf({
      tiers: [{ refundPercent: 10 }, { refundPercent: 20 }],
    });

    expect(errors.map(({ field }) => field).sort()).toEqual([
      'tiers.0.daysBefore',
      'tiers.1.daysBefore',
    ]);
  });

  it('refuses a field the body may not have', async () => {
    expect(await invalidFields({ ...valid, airlineId: 'x' })).toEqual([
      'airlineId',
    ]);
  });
});
