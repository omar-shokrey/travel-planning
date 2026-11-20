import { FlightBookingStatus } from '../flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from '../flight-bookings/enums/passenger-type.enum';
import { csvField, toPassengerCsv } from './flight-passengers-csv';
import { CabinClass } from './models/cabin-class.enum';

describe('csvField (FLT-29)', () => {
  it('leaves a plain value as it is', () => {
    expect(csvField('Sara Ahmed')).toBe('Sara Ahmed');
  });

  it.each([
    ['Ahmed, Sara', '"Ahmed, Sara"'],
    ['Sara "Sue" Ahmed', '"Sara ""Sue"" Ahmed"'],
    ['two\nlines', '"two\nlines"'],
  ])('quotes %p as %p', (value, field) => {
    expect(csvField(value)).toBe(field);
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])(
    'never lets a spreadsheet run %p as a formula',
    (value) => {
      expect(csvField(value).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );
});

describe('toPassengerCsv (FLT-29)', () => {
  it('writes a header and one CRLF row per passenger, after a UTF-8 BOM', () => {
    const csv = toPassengerCsv([
      {
        bookingId: 'b1',
        reference: 'FB111111',
        status: FlightBookingStatus.Confirmed,
        cabin: CabinClass.Business,
        seats: 1,
        passengers: [
          { fullName: 'Zoë Ahmed', type: PassengerType.Adult },
          { fullName: 'Baby Ahmed', type: PassengerType.Infant },
        ],
        cancelledAt: null,
      },
      {
        bookingId: 'b2',
        reference: 'FB222222',
        status: FlightBookingStatus.Completed,
        cabin: CabinClass.Economy,
        seats: 1,
        passengers: [{ fullName: 'Ahmed, Omar', type: PassengerType.Child }],
        cancelledAt: null,
      },
    ]);

    expect(csv).toBe(
      '\uFEFFReference,Passenger,Type,Cabin,Booking status\r\n' +
        'FB111111,Zoë Ahmed,adult,business,confirmed\r\n' +
        'FB111111,Baby Ahmed,infant,business,confirmed\r\n' +
        'FB222222,"Ahmed, Omar",child,economy,completed\r\n',
    );
  });

  it('writes only the header when no one flies', () => {
    expect(toPassengerCsv([])).toBe(
      '\uFEFFReference,Passenger,Type,Cabin,Booking status\r\n',
    );
  });
});
