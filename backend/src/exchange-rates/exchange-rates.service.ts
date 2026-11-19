import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import type { Model } from 'mongoose';
import { EXCHANGE_RATE_RETRY_AFTER_MS } from './exchange-rates.constants';
import { FxRatesClient } from './fx-rates.client';
import { ExchangeRate } from './models/exchange-rate.schema';

/** The rates in use: the newest cached day. */
export interface RateSet {
  /** The date the rates are for (`YYYY-MM-DD`). */
  rateDate: string;
  /** When they were fetched. */
  fetchedAt: Date;
  /** Currency code to units per one US dollar. */
  rates: Record<string, number>;
}

/**
 * ITN-18: exchange rates fetched from FXRatesAPI at most once a day and
 * cached in `exchange_rates`. A request reads the newest cached day; when it
 * was not fetched today (UTC), the request first fetches. When the API is
 * unavailable or no key is set, the last cached rates are used.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  /** The fetch in progress, so requests at the same moment share one call. */
  private refreshing: Promise<void> | null = null;

  /** When the last fetch failed, so the API is not asked on every request. */
  private lastFailureAt: number | null = null;

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly rates: Model<ExchangeRate>,
    private readonly client: FxRatesClient,
  ) {}

  /**
   * The rates to convert with: fetched today if possible, otherwise the last
   * cached ones. `null` only when nothing was ever cached and the fetch fails.
   */
  async latest(now: Date = new Date()): Promise<RateSet | null> {
    const cached = await this.newestCached();
    if (cached && cached.fetchedAt >= startOfUtcDay(now)) {
      return cached;
    }
    if (
      this.lastFailureAt !== null &&
      now.getTime() - this.lastFailureAt < EXCHANGE_RATE_RETRY_AFTER_MS
    ) {
      return cached;
    }
    this.refreshing ??= this.refresh(now).finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
    return (await this.newestCached()) ?? cached;
  }

  /** Fetches the rates and stores them under their date. Never throws. */
  private async refresh(now: Date): Promise<void> {
    try {
      const fetched = await this.client.fetchLatest();
      await this.rates.updateOne(
        { _id: fetched.date },
        { $set: { rates: fetched.rates, fetchedAt: now } },
        { upsert: true, runValidators: true },
      );
      this.lastFailureAt = null;
    } catch (error) {
      this.lastFailureAt = now.getTime();
      this.logger.warn(
        `Exchange rates not fetched, the cached ones are used: ${(error as Error).message}`,
      );
    }
  }

  private async newestCached(): Promise<RateSet | null> {
    const newest = await this.rates
      .findOne()
      .sort({ fetchedAt: -1, _id: -1 })
      .lean()
      .exec();
    if (!newest) return null;
    return {
      rateDate: newest._id,
      fetchedAt: newest.fetchedAt,
      rates: Object.fromEntries(
        newest.rates instanceof Map
          ? newest.rates
          : Object.entries(newest.rates as Record<string, number>),
      ),
    };
  }
}

/** Midnight UTC of the day `now` falls on. */
function startOfUtcDay(now: Date): Date {
  return DateTime.fromJSDate(now, { zone: 'utc' }).startOf('day').toJSDate();
}
