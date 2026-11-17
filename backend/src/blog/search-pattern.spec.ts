import { containsKeyword, escapeRegExp } from './search-pattern';

describe('escapeRegExp (BLG-09)', () => {
  it('leaves plain text as it is', () => {
    expect(escapeRegExp('cairo trip')).toBe('cairo trip');
  });

  it('escapes every character a regular expression gives a meaning to', () => {
    const special = '.*+?^${}()|[]\\';

    const escaped = escapeRegExp(special);

    expect(new RegExp(escaped).test(special)).toBe(true);
    expect(new RegExp(`^${escaped}$`).test('anything')).toBe(false);
  });

  it('makes a keyword such as ".*(" match only itself', () => {
    const pattern = new RegExp(escapeRegExp('.*('), 'i');

    expect(pattern.test('a .*( b')).toBe(true);
    expect(pattern.test('any title at all')).toBe(false);
  });
});

describe('containsKeyword', () => {
  it('builds a case-insensitive condition with the escaped keyword', () => {
    expect(containsKeyword('C++ (guide)')).toEqual({
      $regex: 'C\\+\\+ \\(guide\\)',
      $options: 'i',
    });
  });
});
