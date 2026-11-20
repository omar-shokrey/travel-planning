import { CabinClass } from '../flights/models/cabin-class.enum';
import { bookingChangedMessage } from './booking-change-message';

const leg = {
  flightNumber: 'MS124',
  departureAirport: 'JFK',
  arrivalAirport: 'CAI',
  departureLocal: '2027-06-20T09:15',
  cabin: CabinClass.Economy,
  seats: 2,
};

describe('bookingChangedMessage (FLT-27)', () => {
  it('names the reference, the new flight with its local time, and the paid difference', () => {
    expect(bookingChangedMessage('FB-7KQ2MX', 1, leg, 4200, 'USD')).toBe(
      'Your flight booking FB-7KQ2MX was changed. Return: MS124 JFK to CAI, departs 2027-06-20 09:15 JFK time, Economy, 2 seats. You paid the fare difference of 42.00 USD.',
    );
  });

  it('says a cheaper flight is refunded, and an equal one changed nothing in price', () => {
    expect(bookingChangedMessage('FB-1', 0, leg, -4005, 'USD')).toBe(
      'Your flight booking FB-1 was changed. MS124 JFK to CAI, departs 2027-06-20 09:15 JFK time, Economy, 2 seats. The fare difference of 40.05 USD is being refunded to your card.',
    );
    expect(bookingChangedMessage('FB-1', 0, leg, 0, 'USD')).toMatch(
      /The price did not change\.$/,
    );
  });
});
