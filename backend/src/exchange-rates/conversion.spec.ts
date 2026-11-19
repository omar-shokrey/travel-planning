import { convertAmount, convertTotal, minorUnitDigits } from './conversion';

/** Dollar rates: how many units one US dollar buys. */
const rates = { USD: 1, EGP: 50, EUR: 0.8, JPY: 150, KWD: 0.3 };

describe('minorUnitDigits (ITN-18)', () => {
  it.each([
    ['USD', 2],
    ['EGP', 2],
    ['EUR', 2],
    ['JPY', 0],
    ['IDR', 0],
    ['KWD', 3],
  ])('%s has %p decimal places', (currency, digits) => {
    expect(minorUnitDigits(currency)).toBe(digits);
  });
});

describe('convertAmount (ITN-18)', () => {
  it('keeps an amount that is already in the right currency, even without rates', () => {
    expect(convertAmount(12345, 'EGP', 'EGP', {})).toBe(12345);
  });

  it('converts through the dollar rates', () => {
    // USD 10.00 = EGP 500.00; EGP 500.00 = USD 10.00; EUR 8.00 = EGP 500.00.
    expect(convertAmount(1000, 'USD', 'EGP', rates)).toBe(50000);
    expect(convertAmount(50000, 'EGP', 'USD', rates)).toBe(1000);
    expect(convertAmount(800, 'EUR', 'EGP', rates)).toBe(50000);
  });

  it('follows the decimal places of both currencies', () => {
    // USD 10.00 = JPY 1,500 (no decimals); JPY 1,500 = USD 10.00.
    expect(convertAmount(1000, 'USD', 'JPY', rates)).toBe(1500);
    expect(convertAmount(1500, 'JPY', 'USD', rates)).toBe(1000);
    // USD 10.00 = KWD 3.000, which is 3000 fils.
    expect(convertAmount(1000, 'USD', 'KWD', rates)).toBe(3000);
  });

  it('rounds to the nearest minor unit', () => {
    // EGP 0.01 = USD 0.0002, rounded to 0; EGP 0.25 = USD 0.005, rounded up.
    expect(convertAmount(1, 'EGP', 'USD', rates)).toBe(0);
    expect(convertAmount(25, 'EGP', 'USD', rates)).toBe(1);
    expect(convertAmount(0, 'USD', 'EGP', rates)).toBe(0);
  });

  it('gives null when a rate is missing, zero or not a number', () => {
    expect(convertAmount(100, 'GBP', 'USD', rates)).toBeNull();
    expect(convertAmount(100, 'USD', 'GBP', rates)).toBeNull();
    expect(convertAmount(100, 'USD', 'EGP', { USD: 1, EGP: 0 })).toBeNull();
    expect(convertAmount(100, 'USD', 'EGP', { USD: 1, EGP: NaN })).toBeNull();
  });

  it('gives null when the result is too big to stay exact', () => {
    // The largest itinerary total (README of itineraries) in USD, in IDR.
    expect(
      convertAmount(2_621_440_000_000_000, 'USD', 'IDR', {
        USD: 1,
        IDR: 16000,
      }),
    ).toBeNull();
  });
});

describe('convertTotal (ITN-18)', () => {
  it('converts each currency and adds them up', () => {
    expect(
      convertTotal(
        [
          { amount: 50000, currency: 'EGP' },
          { amount: 1000, currency: 'USD' },
        ],
        'USD',
        rates,
      ),
    ).toEqual({ amount: 2000, currency: 'USD' });
  });

  it('gives zero for an empty list', () => {
    expect(convertTotal([], 'EGP', rates)).toEqual({
      amount: 0,
      currency: 'EGP',
    });
  });

  it('gives null when one of the currencies cannot be converted', () => {
    expect(
      convertTotal(
        [
          { amount: 1000, currency: 'USD' },
          { amount: 1000, currency: 'GBP' },
        ],
        'EGP',
        rates,
      ),
    ).toBeNull();
  });

  it('gives null when the sum is too big to stay exact', () => {
    const big = { amount: Number.MAX_SAFE_INTEGER - 1, currency: 'USD' };
    expect(convertTotal([big, big], 'USD', rates)).toBeNull();
  });
});
