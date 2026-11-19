import {
  HOTEL_REFERENCE_PATTERN,
  newHotelReference,
  REFERENCE_ALPHABET,
} from './booking-reference';

describe('newHotelReference (HTL-17)', () => {
  it('gives HB- and 6 characters of the alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(newHotelReference()).toMatch(HOTEL_REFERENCE_PATTERN);
    }
  });

  it('never uses a look-alike character', () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('gives a different reference each time', () => {
    const references = new Set(
      Array.from({ length: 500 }, () => newHotelReference()),
    );
    // 500 draws from about 887 million: a repeat is practically impossible.
    expect(references.size).toBe(500);
  });
});
