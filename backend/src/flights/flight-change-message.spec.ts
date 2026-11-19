import {
  type FlightSchedule,
  flightTimeChangeMessage,
  minuteOf,
} from './flight-change-message';

const before: FlightSchedule = {
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  // 14:30 in Cairo (UTC+3 in June) and 18:30 in New York (UTC-4).
  departureAt: new Date('2027-06-15T11:30:00.000Z'),
  arrivalAt: new Date('2027-06-15T22:30:00.000Z'),
  departureZone: 'Africa/Cairo',
  arrivalZone: 'America/New_York',
};

describe('flightTimeChangeMessage (FLT-05, GEN-06)', () => {
  it('names the flight and the route, and gives each new and old time at its airport', () => {
    const after: FlightSchedule = {
      ...before,
      departureAt: new Date('2027-06-15T13:30:00.000Z'),
      arrivalAt: new Date('2027-06-16T00:30:00.000Z'),
    };

    expect(flightTimeChangeMessage('MS123', before, after)).toBe(
      'Flight MS123 from CAI to JFK has new times. Departure: 2027-06-15 16:30 CAI time (was 2027-06-15 14:30). Arrival: 2027-06-15 20:30 JFK time (was 2027-06-15 18:30).',
    );
  });

  it('says which time did not change', () => {
    const after: FlightSchedule = {
      ...before,
      departureAt: new Date('2027-06-15T10:30:00.000Z'),
    };

    expect(flightTimeChangeMessage('MS123', before, after)).toBe(
      'Flight MS123 from CAI to JFK has new times. Departure: 2027-06-15 13:30 CAI time (was 2027-06-15 14:30). Arrival: 2027-06-15 18:30 JFK time (unchanged).',
    );
  });

  it('follows daylight saving: the same UTC hour is another local hour in winter', () => {
    const winter: FlightSchedule = {
      ...before,
      departureAt: new Date('2027-12-15T11:30:00.000Z'),
      arrivalAt: new Date('2027-12-15T23:30:00.000Z'),
    };
    const after: FlightSchedule = {
      ...winter,
      arrivalAt: new Date('2027-12-16T00:30:00.000Z'),
    };

    // Cairo is UTC+2 and New York UTC-5 in December.
    expect(flightTimeChangeMessage('MS123', winter, after)).toBe(
      'Flight MS123 from CAI to JFK has new times. Departure: 2027-12-15 13:30 CAI time (unchanged). Arrival: 2027-12-15 19:30 JFK time (was 2027-12-15 18:30).',
    );
  });

  it('adds the UTC offsets when the clocks go back and two instants show the same clock time', () => {
    // New York, 2027-11-07: 01:30 happens at 05:30 UTC (-04:00) and again at 06:30 UTC (-05:00).
    const atNight: FlightSchedule = {
      ...before,
      departureAt: new Date('2027-11-06T17:30:00.000Z'),
      arrivalAt: new Date('2027-11-07T05:30:00.000Z'),
    };
    const after: FlightSchedule = {
      ...atNight,
      arrivalAt: new Date('2027-11-07T06:30:00.000Z'),
    };

    expect(flightTimeChangeMessage('MS123', atNight, after)).toBe(
      'Flight MS123 from CAI to JFK has new times. Departure: 2027-11-06 19:30 CAI time (unchanged). Arrival: 2027-11-07 01:30 JFK time, UTC-05:00 (was 2027-11-07 01:30, UTC-04:00).',
    );
  });

  it('decides "unchanged" by the instant to the minute, like the service (minuteOf)', () => {
    const withSeconds: FlightSchedule = {
      ...before,
      departureAt: new Date('2027-06-15T11:30:45.000Z'),
    };

    expect(minuteOf(withSeconds.departureAt)).toBe(
      minuteOf(before.departureAt),
    );
    expect(flightTimeChangeMessage('MS123', withSeconds, before)).toContain(
      'Departure: 2027-06-15 14:30 CAI time (unchanged).',
    );
  });

  it('stays well under the 500 characters of a notification', () => {
    const after: FlightSchedule = {
      ...before,
      departureAt: new Date('2027-06-15T13:30:00.000Z'),
    };

    expect(
      flightTimeChangeMessage('ABCDEFGHIJ', before, after).length,
    ).toBeLessThan(200);
  });
});
