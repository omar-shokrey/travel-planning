import { CabinClass } from '../flights/models/cabin-class.enum';
import {
  bookingConfirmedMessage,
  type ConfirmedLeg,
} from './booking-confirmation-message';

const outbound: ConfirmedLeg = {
  flightNumber: 'MS123',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureLocal: '2027-06-15T14:30',
  cabin: CabinClass.Economy,
  seats: 2,
};

describe('bookingConfirmedMessage (FLT-23)', () => {
  it('names the reference, the flight, the route, the local departure, the cabin and the seats', () => {
    expect(bookingConfirmedMessage('FB-7KQ2MX', [outbound], 0)).toBe(
      'Your flight booking FB-7KQ2MX is confirmed. MS123 CAI to JFK, departs 2027-06-15 14:30 CAI time, Economy, 2 seats.',
    );
  });

  it('adds the return flight of a round trip, and one seat in the singular', () => {
    const back: ConfirmedLeg = {
      flightNumber: 'MS124',
      departureAirport: 'JFK',
      arrivalAirport: 'CAI',
      departureLocal: '2027-06-22T21:05',
      cabin: CabinClass.PremiumEconomy,
      seats: 1,
    };

    expect(
      bookingConfirmedMessage(
        'FB-7KQ2MX',
        [{ ...outbound, seats: 1 }, back],
        0,
      ),
    ).toBe(
      'Your flight booking FB-7KQ2MX is confirmed. MS123 CAI to JFK, departs 2027-06-15 14:30 CAI time, Economy, 1 seat. Return: MS124 JFK to CAI, departs 2027-06-22 21:05 JFK time, Premium economy, 1 seat.',
    );
  });

  it('names the infants, who occupy no seat', () => {
    expect(bookingConfirmedMessage('FB-7KQ2MX', [outbound], 1)).toMatch(
      / Plus 1 infant on a lap \(no seat\)\.$/,
    );
    expect(bookingConfirmedMessage('FB-7KQ2MX', [outbound], 2)).toMatch(
      / Plus 2 infants on a lap \(no seat\)\.$/,
    );
  });
});
