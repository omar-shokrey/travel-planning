import { Mongoose } from 'mongoose';
import { EXTRA_BAG_PRICE_MAX, MAX_EXTRA_BAGS_MAX } from '../flights.constants';
import { Airline, AirlineSchema } from './airline.schema';

const valid = () => ({ name: 'EgyptAir', code: 'MS', logo: 'logo.png' });

const model = () => new Mongoose().model(Airline.name, AirlineSchema);

/** The validation errors of an airline, by path. Empty when it is valid. */
async function errorsOf(fields: Record<string, unknown>): Promise<string[]> {
  const AirlineModel = model();
  const error = (await new AirlineModel(fields)
    .validate()
    .catch((caught: unknown) => caught)) as
    { errors?: Record<string, unknown> } | undefined;
  return Object.keys(error?.errors ?? {}).sort();
}

describe('Airline policy schema, extra-bag rule (FLT-08)', () => {
  it('starts with no extra-bag rule: both fields are absent, not 0', () => {
    const AirlineModel = model();
    const airline = new AirlineModel(valid());

    expect(airline.policy?.extraBagPrice).toBeUndefined();
    expect(airline.policy?.maxExtraBags).toBeUndefined();
    expect(airline.policy?.cancellationTiers).toEqual([]);
  });

  it('accepts the boundaries of both fields', async () => {
    expect(
      await errorsOf({
        ...valid(),
        policy: { extraBagPrice: 1, maxExtraBags: 0 },
      }),
    ).toEqual([]);
    expect(
      await errorsOf({
        ...valid(),
        policy: {
          extraBagPrice: EXTRA_BAG_PRICE_MAX,
          maxExtraBags: MAX_EXTRA_BAGS_MAX,
        },
      }),
    ).toEqual([]);
  });

  it.each([
    ['a price of 0', { extraBagPrice: 0 }, 'policy.extraBagPrice'],
    ['a fractional price', { extraBagPrice: 12.5 }, 'policy.extraBagPrice'],
    [
      'a price above the limit',
      { extraBagPrice: EXTRA_BAG_PRICE_MAX + 1 },
      'policy.extraBagPrice',
    ],
    ['a negative maximum', { maxExtraBags: -1 }, 'policy.maxExtraBags'],
    ['a fractional maximum', { maxExtraBags: 1.5 }, 'policy.maxExtraBags'],
    [
      'a maximum above the limit',
      { maxExtraBags: MAX_EXTRA_BAGS_MAX + 1 },
      'policy.maxExtraBags',
    ],
  ])('refuses %s', async (_label, policy, path) => {
    expect(await errorsOf({ ...valid(), policy })).toEqual([path]);
  });

  it('stores both fields as numbers (explicit type)', () => {
    const policy = AirlineSchema.path('policy') as unknown as {
      schema: { path: (name: string) => { instance: string } };
    };

    expect(policy.schema.path('extraBagPrice').instance).toBe('Number');
    expect(policy.schema.path('maxExtraBags').instance).toBe('Number');
  });
});
