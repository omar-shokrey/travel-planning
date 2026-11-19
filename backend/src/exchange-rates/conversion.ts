/** An amount in whole minor units of a currency. */
export interface Money {
  amount: number;
  currency: string;
}

/** Exchange rates: currency code to units per one US dollar. */
export type Rates = Readonly<Record<string, number>>;

/**
 * How many digits a currency has after the decimal point: 2 for USD and EGP,
 * 0 for JPY, 3 for KWD. It comes from the ISO 4217 data that Node ships with
 * (`Intl`), so no table is kept by hand.
 */
export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/**
 * Converts whole minor units of one currency into whole minor units of
 * another, through the dollar rates, rounded to the nearest unit. `null` when
 * a rate is missing or the result is not an exact whole number any more.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Rates,
): number | null {
  if (from === to) return amount;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!(fromRate > 0) || !(toRate > 0)) return null;
  const digits = minorUnitDigits(to) - minorUnitDigits(from);
  const converted = Math.round(((amount * toRate) / fromRate) * 10 ** digits);
  return Number.isSafeInteger(converted) ? converted : null;
}

/**
 * One total in `to` for amounts in several currencies: each amount is
 * converted on its own, then they are added. `null` when one of them cannot
 * be converted, so a total never leaves part of the money out.
 */
export function convertTotal(
  totals: readonly Money[],
  to: string,
  rates: Rates,
): Money | null {
  let amount = 0;
  for (const total of totals) {
    const converted = convertAmount(total.amount, total.currency, to, rates);
    if (converted === null) return null;
    amount += converted;
  }
  return Number.isSafeInteger(amount) ? { amount, currency: to } : null;
}
