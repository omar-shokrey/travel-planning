import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ROOM_QUERY_MAX_NIGHTS } from './hotels.constants';
import { todayUtc } from './room-dates';
import { assertStay, invalid } from './stay-rules';

const plusDays = (date: string, days: number): string =>
  DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate() as string;

/** The body of the 400 that `assertStay` throws for `stay`. */
const errorFor = (stay: { from: string; to: string }): unknown => {
  try {
    assertStay(stay);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('assertStay did not throw');
};

describe('invalid', () => {
  it('builds a 400 in the project shape that names the field', () => {
    const error = invalid('checkIn', 'checkIn cannot be in the past');

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      message: 'Validation failed',
      errors: [
        { field: 'checkIn', messages: ['checkIn cannot be in the past'] },
      ],
    });
  });
});

describe('assertStay (HTL-11, HTL-15, HTL-02)', () => {
  const today = todayUtc();

  it('accepts a stay that starts today (UTC)', () => {
    expect(() =>
      assertStay({ from: today, to: plusDays(today, 1) }),
    ).not.toThrow();
  });

  it(`accepts a stay of exactly ${ROOM_QUERY_MAX_NIGHTS} nights`, () => {
    expect(() =>
      assertStay({ from: today, to: plusDays(today, ROOM_QUERY_MAX_NIGHTS) }),
    ).not.toThrow();
  });

  it('rejects a check-in yesterday, naming checkIn', () => {
    expect(errorFor({ from: plusDays(today, -1), to: today })).toEqual({
      message: 'Validation failed',
      errors: [
        { field: 'checkIn', messages: ['checkIn cannot be in the past'] },
      ],
    });
  });

  it(`rejects a stay of ${ROOM_QUERY_MAX_NIGHTS + 1} nights, naming checkOut`, () => {
    expect(
      errorFor({ from: today, to: plusDays(today, ROOM_QUERY_MAX_NIGHTS + 1) }),
    ).toEqual({
      message: 'Validation failed',
      errors: [
        {
          field: 'checkOut',
          messages: [`A stay can have at most ${ROOM_QUERY_MAX_NIGHTS} nights`],
        },
      ],
    });
  });

  it('checks the past before the length', () => {
    expect(errorFor({ from: '2020-01-01', to: '2099-01-01' })).toMatchObject({
      errors: [{ field: 'checkIn' }],
    });
  });
});
