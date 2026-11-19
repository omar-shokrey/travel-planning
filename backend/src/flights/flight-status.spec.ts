import {
  effectiveStatus,
  hasDeparted,
  scheduledFlightFilter,
} from './flight-status';
import { FlightStatus } from './models/flight-status.enum';

const NOW = new Date('2027-06-15T11:30:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe('flight status (FLT-30)', () => {
  beforeEach(() => {
    // A fake clock, so a test that read the real time by mistake would fail.
    jest.useFakeTimers({ now: new Date('2000-01-01T00:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('hasDeparted', () => {
    it('is false 1 ms before the departure time', () => {
      expect(hasDeparted({ departureAt: at(1) }, NOW)).toBe(false);
    });

    it('is true at the exact departure instant', () => {
      expect(hasDeparted({ departureAt: at(0) }, NOW)).toBe(true);
    });

    it('is true 1 ms after the departure time', () => {
      expect(hasDeparted({ departureAt: at(-1) }, NOW)).toBe(true);
    });

    it('reads the time it is given, not the clock', () => {
      // The fake clock says 2000; the flight departs in 2027.
      expect(hasDeparted({ departureAt: at(1) }, at(2))).toBe(true);
    });
  });

  describe('effectiveStatus', () => {
    it.each([
      ['1 ms before departure', 1, FlightStatus.Scheduled],
      ['at the departure instant', 0, FlightStatus.Departed],
      ['1 ms after departure', -1, FlightStatus.Departed],
    ])('a stored scheduled flight %s is %s', (_case, offset, expected) => {
      expect(
        effectiveStatus(
          { status: FlightStatus.Scheduled, departureAt: at(offset) },
          NOW,
        ),
      ).toBe(expected);
    });

    it.each([1, 0, -1, -86_400_000])(
      'a cancelled flight stays cancelled (departure %p ms from now)',
      (offset) => {
        expect(
          effectiveStatus(
            { status: FlightStatus.Cancelled, departureAt: at(offset) },
            NOW,
          ),
        ).toBe(FlightStatus.Cancelled);
      },
    );

    it.each([1, -1])(
      'a stored departed flight stays departed (departure %p ms from now)',
      (offset) => {
        expect(
          effectiveStatus(
            { status: FlightStatus.Departed, departureAt: at(offset) },
            NOW,
          ),
        ).toBe(FlightStatus.Departed);
      },
    );
  });

  describe('scheduledFlightFilter', () => {
    it('matches a flight stored as scheduled that departs strictly after now', () => {
      expect(scheduledFlightFilter(NOW)).toEqual({
        status: FlightStatus.Scheduled,
        departureAt: { $gt: NOW },
      });
    });

    it('uses the time it is given', () => {
      const later = at(60_000);

      expect(scheduledFlightFilter(later)).toEqual({
        status: FlightStatus.Scheduled,
        departureAt: { $gt: later },
      });
    });

    it('agrees with effectiveStatus at the boundary', () => {
      // The filter is $gt now: a flight departing exactly now is not
      // matched, and effectiveStatus calls it departed.
      const filter = scheduledFlightFilter(NOW) as {
        departureAt: { $gt: Date };
      };
      for (const offset of [1, 0, -1]) {
        const departureAt = at(offset);
        const matched = departureAt > filter.departureAt.$gt;
        const scheduled =
          effectiveStatus(
            { status: FlightStatus.Scheduled, departureAt },
            NOW,
          ) === FlightStatus.Scheduled;
        expect([offset, matched]).toEqual([offset, scheduled]);
      }
    });
  });
});
