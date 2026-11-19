import type { Model } from 'mongoose';
import { EXCHANGE_RATE_RETRY_AFTER_MS } from './exchange-rates.constants';
import { ExchangeRatesService } from './exchange-rates.service';
import type { FetchedRates, FxRatesClient } from './fx-rates.client';
import type { ExchangeRate } from './models/exchange-rate.schema';

interface StoredDay {
  _id: string;
  rates: Record<string, number>;
  fetchedAt: Date;
}

/** An `exchange_rates` collection in memory, with the calls the service makes. */
const fakeCollection = (days: StoredDay[]) => ({
  days,
  findOne: () => ({
    sort: () => ({
      lean: () => ({
        exec: () =>
          Promise.resolve(
            [...days].sort(
              (a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime(),
            )[0] ?? null,
          ),
      }),
    }),
  }),
  updateOne: jest.fn(
    (
      filter: { _id: string },
      update: { $set: { rates: Record<string, number>; fetchedAt: Date } },
    ) => {
      const existing = days.find((day) => day._id === filter._id);
      if (existing) Object.assign(existing, update.$set);
      else days.push({ _id: filter._id, ...update.$set });
      return Promise.resolve({ acknowledged: true });
    },
  ),
});

const NOW = new Date('2026-11-19T10:00:00.000Z');
const YESTERDAY = new Date('2026-11-18T07:00:00.000Z');
const TODAY_EARLY = new Date('2026-11-19T00:30:00.000Z');

const fresh: FetchedRates = { date: '2026-11-19', rates: { USD: 1, EGP: 49 } };

const setUp = (days: StoredDay[], fetchLatest: jest.Mock) => {
  const collection = fakeCollection(days);
  const service = new ExchangeRatesService(
    collection as unknown as Model<ExchangeRate>,
    { fetchLatest } as unknown as FxRatesClient,
  );
  return { service, collection };
};

describe('ExchangeRatesService (ITN-18)', () => {
  it('uses the rates fetched today without asking the API', async () => {
    const fetchLatest = jest.fn();
    const { service } = setUp(
      [
        {
          _id: '2026-11-19',
          rates: { USD: 1, EGP: 48 },
          fetchedAt: TODAY_EARLY,
        },
      ],
      fetchLatest,
    );

    const rates = await service.latest(NOW);

    expect(rates).toEqual({
      rateDate: '2026-11-19',
      fetchedAt: TODAY_EARLY,
      rates: { USD: 1, EGP: 48 },
    });
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('fetches once a day and stores the rates under their date', async () => {
    const fetchLatest = jest.fn().mockResolvedValue(fresh);
    const { service, collection } = setUp(
      [{ _id: '2026-11-18', rates: { USD: 1, EGP: 48 }, fetchedAt: YESTERDAY }],
      fetchLatest,
    );

    const rates = await service.latest(NOW);
    await service.latest(NOW);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: '2026-11-19' },
      { $set: { rates: { USD: 1, EGP: 49 }, fetchedAt: NOW } },
      { upsert: true, runValidators: true },
    );
    expect(rates).toEqual({
      rateDate: '2026-11-19',
      fetchedAt: NOW,
      rates: { USD: 1, EGP: 49 },
    });
  });

  it('replaces the rates when the API gives a date already stored', async () => {
    const fetchLatest = jest
      .fn()
      .mockResolvedValue({ date: '2026-11-18', rates: { USD: 1, EGP: 47 } });
    const { service, collection } = setUp(
      [{ _id: '2026-11-18', rates: { USD: 1, EGP: 48 }, fetchedAt: YESTERDAY }],
      fetchLatest,
    );

    const rates = await service.latest(NOW);

    expect(collection.days).toHaveLength(1);
    expect(rates?.rates).toEqual({ USD: 1, EGP: 47 });
    expect(rates?.fetchedAt).toEqual(NOW);
  });

  it('shares one fetch between requests at the same moment', async () => {
    let finish: (value: FetchedRates) => void = () => undefined;
    const fetchLatest = jest.fn(
      () =>
        new Promise<FetchedRates>((resolve) => {
          finish = resolve;
        }),
    );
    const { service } = setUp([], fetchLatest);

    const both = Promise.all([service.latest(NOW), service.latest(NOW)]);
    await new Promise((resolve) => setImmediate(resolve));
    finish(fresh);
    const [first, second] = await both;

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(first?.rateDate).toBe('2026-11-19');
    expect(second?.rateDate).toBe('2026-11-19');
  });

  it('uses the last cached rates when the API fails, and waits before asking again', async () => {
    const fetchLatest = jest
      .fn()
      .mockRejectedValue(new Error('FXRatesAPI answered 500'));
    const { service } = setUp(
      [{ _id: '2026-11-18', rates: { USD: 1, EGP: 48 }, fetchedAt: YESTERDAY }],
      fetchLatest,
    );
    const warn = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    const rates = await service.latest(NOW);
    const soon = new Date(NOW.getTime() + EXCHANGE_RATE_RETRY_AFTER_MS - 1);
    await service.latest(soon);

    expect(rates?.rateDate).toBe('2026-11-18');
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Exchange rates not fetched, the cached ones are used: FXRatesAPI answered 500',
    );

    fetchLatest.mockResolvedValue(fresh);
    const later = new Date(NOW.getTime() + EXCHANGE_RATE_RETRY_AFTER_MS);
    const recovered = await service.latest(later);

    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(recovered?.rateDate).toBe('2026-11-19');
  });

  it('gives null when nothing is cached and the fetch fails', async () => {
    const fetchLatest = jest
      .fn()
      .mockRejectedValue(new Error('FXRATES_API_KEY is not set'));
    const { service } = setUp([], fetchLatest);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    await expect(service.latest(NOW)).resolves.toBeNull();
  });

  it('reads rates stored as a Map', async () => {
    const { service } = setUp(
      [
        {
          _id: '2026-11-19',
          rates: new Map([['EGP', 48]]) as unknown as Record<string, number>,
          fetchedAt: TODAY_EARLY,
        },
      ],
      jest.fn(),
    );

    expect((await service.latest(NOW))?.rates).toEqual({ EGP: 48 });
  });
});
