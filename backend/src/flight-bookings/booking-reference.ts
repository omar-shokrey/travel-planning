import { randomInt } from 'node:crypto';

/**
 * The characters of a booking reference: upper-case letters and digits
 * without the look-alikes 0/O and 1/I/L, so a reference read aloud or copied
 * from a printed e-ticket is not mistyped.
 */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** How many random characters follow the prefix. 31^6 is about 887 million references. */
export const REFERENCE_LENGTH = 6;

/** The prefix of a flight booking reference, so it is never mixed up with a hotel one. */
export const FLIGHT_REFERENCE_PREFIX = 'FB';

/** The format of a flight booking reference, for example `FB-7KQ2MX`. */
export const FLIGHT_REFERENCE_PATTERN = new RegExp(
  `^${FLIGHT_REFERENCE_PREFIX}-[${REFERENCE_ALPHABET}]{${REFERENCE_LENGTH}}$`,
);

/**
 * FLT-23: a new random booking reference, for example `FB-7KQ2MX`. The
 * characters come from `crypto.randomInt`, so a reference cannot be guessed
 * from another one. Uniqueness is the job of the unique index on
 * `reference`: the caller tries again with a new one on a duplicate key.
 */
export function newFlightReference(): string {
  let code = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `${FLIGHT_REFERENCE_PREFIX}-${code}`;
}
