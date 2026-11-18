import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MONEY_AMOUNT_MAX } from '../itineraries.constants';
import { CreateActivityDto } from './create-activity.dto';
import { CreateBudgetEntryDto } from './create-budget-entry.dto';
import { CreateTransportCostDto } from './create-transport-cost.dto';
import { UpdateBudgetEntryDto } from './update-budget-entry.dto';

/** Any of the DTO classes these tests check. */
type Dto = new () => object;

/** The fields that fail, with the options of the global ValidationPipe. */
const invalidFields = async (
  body: Record<string, unknown>,
  dto: Dto = CreateBudgetEntryDto,
): Promise<string[]> =>
  (
    await validate(plainToInstance(dto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  )
    .map((error) => error.property)
    .sort();

const valid = { category: 'food', amount: 45000, currency: 'EGP' };

describe('CreateBudgetEntryDto (ITN-14)', () => {
  it('accepts each of the four categories, and amounts from 0 to the limit', async () => {
    for (const category of [
      'food',
      'accommodation',
      'local_transport',
      'activities',
    ]) {
      expect(await invalidFields({ ...valid, category })).toEqual([]);
    }
    expect(await invalidFields({ ...valid, amount: 0 })).toEqual([]);
    expect(await invalidFields({ ...valid, amount: MONEY_AMOUNT_MAX })).toEqual(
      [],
    );
  });

  it.each([
    ['a negative amount', { amount: -1 }, 'amount'],
    ['a fraction', { amount: 12.5 }, 'amount'],
    ['1e300', { amount: 1e300 }, 'amount'],
    ['an amount above the limit', { amount: MONEY_AMOUNT_MAX + 1 }, 'amount'],
    ['an amount that is text', { amount: '100' }, 'amount'],
    [
      'intercity transport as a category',
      { category: 'intercity_transport' },
      'category',
    ],
    ['an unknown category', { category: 'shopping' }, 'category'],
    ['a currency that is not a code', { currency: 'egp' }, 'currency'],
  ])('rejects %s', async (_label, change, field) => {
    expect(await invalidFields({ ...valid, ...change })).toEqual([field]);
  });

  it('requires a category, an amount and a currency', async () => {
    expect(await invalidFields({})).toEqual(['amount', 'category', 'currency']);
    const { currency: _currency, ...withoutCurrency } = valid;
    expect(await invalidFields(withoutCurrency)).toEqual(['currency']);
  });

  it('rejects an unknown field, so a client cannot set an id or an owner', async () => {
    expect(await invalidFields({ ...valid, ownerId: 'x' })).toEqual([
      'ownerId',
    ]);
  });
});

describe('UpdateBudgetEntryDto (ITN-14)', () => {
  it('accepts any one field, or none', async () => {
    expect(await invalidFields({}, UpdateBudgetEntryDto)).toEqual([]);
    expect(await invalidFields({ amount: 10 }, UpdateBudgetEntryDto)).toEqual(
      [],
    );
  });

  it('keeps the rules of each field it receives', async () => {
    expect(
      await invalidFields(
        { amount: 1e300, category: 'shopping' },
        UpdateBudgetEntryDto,
      ),
    ).toEqual(['amount', 'category']);
  });
});

describe('the money limit on the other amounts of the module (ITN-14)', () => {
  it('caps an activity cost at MONEY_AMOUNT_MAX (ITN-10)', async () => {
    const activity = { name: 'Museum', currency: 'EGP' };

    expect(
      await invalidFields(
        { ...activity, cost: MONEY_AMOUNT_MAX },
        CreateActivityDto,
      ),
    ).toEqual([]);
    expect(
      await invalidFields({ ...activity, cost: 1e300 }, CreateActivityDto),
    ).toEqual(['cost']);
  });

  it('caps a transport amount at MONEY_AMOUNT_MAX (ITN-16)', async () => {
    const trip = {
      dayId: '6741c0ffee0ddba11ad0d0d0',
      mode: 'train',
      fromCityId: 'cairo',
      toCityId: 'luxor',
      currency: 'EGP',
    };

    expect(
      await invalidFields(
        { ...trip, amount: MONEY_AMOUNT_MAX },
        CreateTransportCostDto,
      ),
    ).toEqual([]);
    expect(
      await invalidFields(
        { ...trip, amount: MONEY_AMOUNT_MAX + 1 },
        CreateTransportCostDto,
      ),
    ).toEqual(['amount']);
  });
});
