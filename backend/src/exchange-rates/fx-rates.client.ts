import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import {
  EXCHANGE_RATE_BASE,
  EXCHANGE_RATE_FETCH_TIMEOUT_MS,
} from './exchange-rates.constants';

/** The rates of one day, as read from FXRatesAPI. */
export interface FetchedRates {
  /** The rate date, `YYYY-MM-DD`. */
  date: string;
  /** Currency code to units per one US dollar. */
  rates: Record<string, number>;
}

/** The part of the FXRatesAPI `/latest` answer that is read. */
interface LatestAnswer {
  success?: unknown;
  base?: unknown;
  date?: unknown;
  rates?: unknown;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * Reads the latest exchange rates from FXRatesAPI (ITN-18). Every failure is
 * an error with a short message that never contains the API key. The caller
 * decides what to do with it.
 */
@Injectable()
export class FxRatesClient {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async fetchLatest(): Promise<FetchedRates> {
    const key = this.config.get('FXRATES_API_KEY', { infer: true });
    if (!key) {
      throw new Error('FXRATES_API_KEY is not set');
    }
    const url = new URL(
      '/latest',
      this.config.get('FXRATES_API_URL', { infer: true }),
    );
    url.searchParams.set('base', EXCHANGE_RATE_BASE);
    url.searchParams.set('api_key', key);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(EXCHANGE_RATE_FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new Error('FXRatesAPI could not be reached');
    }
    if (!response.ok) {
      throw new Error(`FXRatesAPI answered ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('FXRatesAPI answered something that is not JSON');
    }
    return parseLatest(body);
  }
}

/**
 * Checks the answer before anything is stored: the dollar base, a date and
 * a positive number for each 3-letter code. Anything else is dropped or
 * refused, so a broken answer can never replace good cached rates.
 */
export function parseLatest(body: unknown): FetchedRates {
  const answer = (body ?? {}) as LatestAnswer;
  if (answer.success === false) {
    throw new Error('FXRatesAPI refused the request');
  }
  if (answer.base !== EXCHANGE_RATE_BASE) {
    throw new Error('FXRatesAPI answered with another base currency');
  }
  const date = typeof answer.date === 'string' ? answer.date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('FXRatesAPI answered without a rate date');
  }
  if (typeof answer.rates !== 'object' || answer.rates === null) {
    throw new Error('FXRatesAPI answered without rates');
  }
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(answer.rates)) {
    if (
      CURRENCY_CODE.test(code) &&
      typeof rate === 'number' &&
      Number.isFinite(rate) &&
      rate > 0
    ) {
      rates[code] = rate;
    }
  }
  rates[EXCHANGE_RATE_BASE] = 1;
  return { date, rates };
}
