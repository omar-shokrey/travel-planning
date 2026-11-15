import { CURRENCY_CODE_PATTERN } from '../itineraries.constants';

/** Money is a whole number of minor units (cents), never a fraction. */
export const wholeMinorUnits = {
  validator: Number.isInteger,
  message: '{PATH} must be a whole number of minor units',
};

/** Options shared by every currency field of an itinerary. */
export const currencyCode = {
  type: String,
  uppercase: true,
  match: CURRENCY_CODE_PATTERN,
};
