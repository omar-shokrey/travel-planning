import { randomInt } from 'node:crypto';

/**
 * The characters of a reservation reference: upper-case letters and digits
 * without the look-alikes 0/O and 1/I/L, so a reference read aloud or copied
 * is not mistyped. The same alphabet and length as a flight booking (FLT-23).
 */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** How many random characters follow the prefix. 31^6 is about 887 million references. */
export const REFERENCE_LENGTH = 6;

/** The prefix of a hotel reservation reference, so it is never mixed up with a flight one (`FB-`). */
export const HOTEL_REFERENCE_PREFIX = 'HB';

/** The format of a hotel reservation reference, for example `HB-7KQ2MX`. */
export const HOTEL_REFERENCE_PATTERN = new RegExp(
  `^${HOTEL_REFERENCE_PREFIX}-[${REFERENCE_ALPHABET}]{${REFERENCE_LENGTH}}$`,
);

/**
 * HTL-17: a new random reservation reference, for example `HB-7KQ2MX`. The
 * characters come from `crypto.randomInt`, so a reference cannot be guessed
 * from another one. Uniqueness is the job of the unique index on
 * `reference`: the caller tries again with a new one on a duplicate key.
 */
export function newHotelReference(): string {
  let code = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `${HOTEL_REFERENCE_PREFIX}-${code}`;
}
