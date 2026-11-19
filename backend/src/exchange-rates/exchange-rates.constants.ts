/**
 * The base currency of the stored rates: every rate says how many units of a
 * currency one US dollar buys. FXRatesAPI is asked for this base.
 */
export const EXCHANGE_RATE_BASE = 'USD';

/**
 * After a failed fetch, the next request waits this long before it asks the
 * API again, and uses the cached rates meanwhile (ITN-18). Without it, every
 * budget summary would wait for an API that is down.
 */
export const EXCHANGE_RATE_RETRY_AFTER_MS = 60 * 60 * 1000;

/** How long one call to FXRatesAPI may take before it counts as failed. */
export const EXCHANGE_RATE_FETCH_TIMEOUT_MS = 5000;
