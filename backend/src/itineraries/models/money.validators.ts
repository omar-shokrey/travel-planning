import {
  CURRENCY_CODE_PATTERN,
  MONEY_AMOUNT_MAX,
} from '../itineraries.constants';

/** Money is a whole number of minor units (cents), never a fraction. */
export const wholeMinorUnits = {
  validator: Number.isInteger,
  message: '{PATH} must be a whole number of minor units',
};

/**
 * Options shared by every amount of an itinerary (activity cost, budget entry,
 * transport cost): whole minor units from 0 to MONEY_AMOUNT_MAX, so no total
 * can lose precision (ITN-14).
 */
export const moneyAmount = {
  min: 0,
  max: MONEY_AMOUNT_MAX,
  validate: wholeMinorUnits,
};

/** Options shared by every currency field of an itinerary. */
export const currencyCode = {
  type: String,
  uppercase: true,
  match: CURRENCY_CODE_PATTERN,
};
