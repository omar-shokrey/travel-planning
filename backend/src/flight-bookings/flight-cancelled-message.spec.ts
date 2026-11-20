import { flightCancelledMessage } from './flight-cancelled-message';

const flight = {
  flightNumber: 'MS777',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureDateLocal: '2027-01-10',
};

describe('flightCancelledMessage (FLT-06)', () => {
  it('names the flight, its local date, the reference and the full refund', () => {
    expect(flightCancelledMessage(flight, 'FB7K2Q9M', 50050, 'USD')).toBe(
      'The airline cancelled flight MS777 CAI to JFK on 2027-01-10. Your booking FB7K2Q9M is cancelled and refunded in full (USD 500.50).',
    );
  });

  it('still reads well for a booking with no reference', () => {
    expect(flightCancelledMessage(flight, undefined, 100, 'USD')).toContain(
      'Your booking is cancelled and refunded in full (USD 1.00).',
    );
  });
});
