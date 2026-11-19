import {
  FLIGHT_REFERENCE_PATTERN,
  newFlightReference,
  REFERENCE_ALPHABET,
} from './booking-reference';

describe('newFlightReference (FLT-23)', () => {
  it('gives FB- and 6 characters of the alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(newFlightReference()).toMatch(FLIGHT_REFERENCE_PATTERN);
    }
  });

  it('never uses a look-alike character', () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('gives a different reference each time', () => {
    const references = new Set(
      Array.from({ length: 500 }, () => newFlightReference()),
    );
    // 500 draws from about 887 million: a repeat is practically impossible.
    expect(references.size).toBe(500);
  });
});
