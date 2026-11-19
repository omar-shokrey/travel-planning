import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import { FxRatesClient, parseLatest } from './fx-rates.client';

const config = (key: string) =>
  ({
    get: (name: keyof EnvironmentVariables) =>
      name === 'FXRATES_API_KEY' ? key : 'http://fx.example.test',
  }) as unknown as ConfigService<EnvironmentVariables, true>;

const answer = {
  success: true,
  base: 'USD',
  date: '2026-11-18T23:59:00.000Z',
  rates: { EGP: 48.65, EUR: 0.86, USD: 1 },
};

const respond = (status: number, body: unknown) =>
  jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    }),
  );

describe('FxRatesClient (ITN-18)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks /latest for dollar rates with the key, and reads the answer', async () => {
    const fetchSpy = respond(200, answer);

    const fetched = await new FxRatesClient(config('the-key')).fetchLatest();

    expect(fetched).toEqual({
      date: '2026-11-18',
      rates: { EGP: 48.65, EUR: 0.86, USD: 1 },
    });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('http://fx.example.test/latest');
    expect(url.searchParams.get('base')).toBe('USD');
    expect(url.searchParams.get('api_key')).toBe('the-key');
  });

  it('does not call the API without a key', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(new FxRatesClient(config('')).fetchLatest()).rejects.toThrow(
      'FXRATES_API_KEY is not set',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'cannot be reached',
      () => jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down')),
      'FXRatesAPI could not be reached',
    ],
    ['answers an error', () => respond(429, {}), 'FXRatesAPI answered 429'],
    [
      'answers something that is not JSON',
      () => respond(200, '<html>'),
      'FXRatesAPI answered something that is not JSON',
    ],
  ])(
    'fails with a clear message when the API %s',
    async (_label, setUp, message) => {
      setUp();

      const failure = new FxRatesClient(config('secret-key')).fetchLatest();

      await expect(failure).rejects.toThrow(message);
      await expect(failure).rejects.not.toThrow(/secret-key/);
    },
  );
});

describe('parseLatest (ITN-18)', () => {
  it.each([
    ['a refusal', { ...answer, success: false }, 'refused'],
    ['another base', { ...answer, base: 'EUR' }, 'another base currency'],
    ['no date', { ...answer, date: undefined }, 'without a rate date'],
    ['a bad date', { ...answer, date: 'yesterday' }, 'without a rate date'],
    ['no rates', { ...answer, rates: null }, 'without rates'],
    ['nothing', null, 'another base currency'],
  ])('refuses %s', (_label, body, message) => {
    expect(() => parseLatest(body)).toThrow(message);
  });

  it('keeps only positive rates of 3-letter codes, and USD is always 1', () => {
    const parsed = parseLatest({
      ...answer,
      rates: {
        EGP: 48.65,
        eur: 0.86,
        GBPX: 0.7,
        JPY: 0,
        SAR: -3.75,
        AED: '3.67',
        KWD: Infinity,
        USD: 2,
      },
    });

    expect(parsed.rates).toEqual({ EGP: 48.65, USD: 1 });
  });
});
