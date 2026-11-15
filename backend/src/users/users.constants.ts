/** The longest name an account may have. Every DTO that accepts a user's name uses it. */
export const USER_NAME_MAX_LENGTH = 100;

/** A currency code: three capital letters, as in `countries.csv` (ACC-09). */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** The answer when the preferred currency is not one of the supported currencies (ACC-09, GEN-12). */
export const UNSUPPORTED_CURRENCY_MESSAGE =
  'preferredCurrency must be a supported currency (a currency of the countries list)';
