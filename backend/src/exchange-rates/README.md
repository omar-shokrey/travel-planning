# exchange-rates

Daily exchange rates for showing money in a user's preferred currency (ITN-18). The platform still charges in USD (PAY-04); converted amounts are for display only.

## Design decisions

- **Source.** FXRatesAPI `/latest` with `base=USD` (`FxRatesClient`). The key is `FXRATES_API_KEY` and the address `FXRATES_API_URL` (`backend/src/config/env.validation.ts`), so the end-to-end tests can point it at a local fake server. The key is never logged or returned: errors carry a short message only.
- **Storage.** One document per rate date in `exchange_rates` (`_id` = `YYYY-MM-DD`, `base`, `rates`, `fetchedAt`), as in the data model. A second fetch of the same date replaces its rates.
- **Once a day, on demand.** There is no timer. `ExchangeRatesService.latest()` reads the newest cached day; when it was not fetched today (UTC), the request fetches first. Every developer's API shares the database, so the first request of the day fetches for everyone, and an unused API never calls FXRatesAPI. Requests at the same moment share one fetch.
- **When the API is down.** A failed fetch (no key, network error, error status, an answer that does not check out) is logged as a warning, and the last cached rates are used. The next fetch waits `EXCHANGE_RATE_RETRY_AFTER_MS` (1 hour), so a dead API does not slow every request. With nothing cached, `latest()` gives `null` and callers show no converted amounts.
- **Checked before stored.** `parseLatest` keeps only positive, finite rates of 3-letter codes, needs the USD base and a rate date, and sets USD to 1. A broken answer never replaces good cached rates.
- **Converting money.** `conversion.ts` has plain functions with no database: `minorUnitDigits` (ISO 4217 decimal places through `Intl`), `convertAmount` (minor units to minor units through the dollar rates, rounded to the nearest unit) and `convertTotal` (several currencies into one total). They give `null` instead of a wrong number when a rate is missing or the result is not a safe integer.
- **No route.** The endpoint list has no exchange-rate route; the itineraries module uses the service for the budget summary.
