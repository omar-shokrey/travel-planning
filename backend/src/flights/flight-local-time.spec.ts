import { toLocalTime } from './flight-local-time';

describe('toLocalTime (GEN-06)', () => {
  it.each([
    [
      'Cairo in winter',
      '2027-01-15T08:00:00.000Z',
      'Africa/Cairo',
      '2027-01-15T10:00',
      '+02:00',
    ],
    [
      'New York in winter (standard time)',
      '2027-01-15T20:00:00.000Z',
      'America/New_York',
      '2027-01-15T15:00',
      '-05:00',
    ],
    [
      'New York in summer (daylight saving time)',
      '2027-07-15T19:00:00.000Z',
      'America/New_York',
      '2027-07-15T15:00',
      '-04:00',
    ],
    [
      'Tokyo, where the local date is the next day',
      '2027-06-15T16:00:00.000Z',
      'Asia/Tokyo',
      '2027-06-16T01:00',
      '+09:00',
    ],
    [
      'Kolkata, a half-hour offset',
      '2027-06-15T06:30:00.000Z',
      'Asia/Kolkata',
      '2027-06-15T12:00',
      '+05:30',
    ],
    [
      'Kathmandu, a quarter-hour offset',
      '2027-06-15T06:15:00.000Z',
      'Asia/Kathmandu',
      '2027-06-15T12:00',
      '+05:45',
    ],
    [
      'the repeated hour in New York: the second 01:30, as create() stores it',
      '2027-11-07T06:30:00.000Z',
      'America/New_York',
      '2027-11-07T01:30',
      '-05:00',
    ],
  ])('shows %s', (_case, instant, timeZone, local, utcOffset) => {
    expect(toLocalTime(new Date(instant), timeZone)).toEqual({
      local,
      timeZone,
      utcOffset,
    });
  });

  it('throws an error that names an unknown zone', () => {
    expect(() =>
      toLocalTime(new Date('2027-01-15T08:00:00.000Z'), 'Mars/Base'),
    ).toThrow('Mars/Base');
  });
});
