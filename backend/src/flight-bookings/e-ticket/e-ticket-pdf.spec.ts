import {
  type ETicket,
  formatMoney,
  maskPassport,
  passengerLines,
  renderETicket,
} from './e-ticket-pdf';

const ticket: ETicket = {
  reference: 'FB-7KQ2MX',
  legs: [
    {
      label: 'Outbound',
      airlineName: 'Nile Air',
      flightNumber: 'NP123',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureLocal: '2027-06-15 14:30',
      departureTimeZone: 'Africa/Cairo',
      departureUtcOffset: '+03:00',
      arrivalLocal: '2027-06-15 20:30',
      arrivalTimeZone: 'America/New_York',
      arrivalUtcOffset: '-04:00',
      cabin: 'Economy',
      seats: 1,
      freeBaggage: '1 bag of up to 23 kg',
    },
  ],
  passengers: [
    {
      fullName: 'Test Adult',
      type: 'Adult',
      passport: '*****01X',
      extraBaggage: ['no extra bags'],
      seats: ['seat 12C'],
    },
  ],
  seats: 1,
  totalPaid: 'USD 250.00',
  changes: [],
};

describe('maskPassport (FLT-23)', () => {
  it('shows only the last 3 characters, behind a fixed 5 stars', () => {
    expect(maskPassport('A1234501X')).toBe('*****01X');
    expect(maskPassport('PAYTEST01')).toBe('*****T01');
    expect(maskPassport('AB12345678901234567')).toBe('*****567');
  });
});

describe('formatMoney (FLT-23)', () => {
  it.each([
    [52500, 'USD 525.00'],
    [1, 'USD 0.01'],
    [10, 'USD 0.10'],
    [123456789, 'USD 1234567.89'],
    [0, 'USD 0.00'],
  ])('formats %p cents as %p', (cents, expected) => {
    expect(formatMoney(cents, 'USD')).toBe(expected);
  });
});

describe('passengerLines (FLT-23, FLT-28)', () => {
  it('prints each passenger, then the seat and the extra bags on each leg', () => {
    expect(passengerLines(ticket)).toEqual([
      'Test Adult (Adult), passport *****01X',
      '   Outbound: seat 12C, no extra bags',
    ]);
  });

  it('prints a seat not chosen yet and an infant without a seat, on every leg of a round trip', () => {
    const roundTrip: ETicket = {
      ...ticket,
      legs: [...ticket.legs, { ...ticket.legs[0], label: 'Return' }],
      passengers: [
        {
          ...ticket.passengers[0],
          extraBaggage: ['no extra bags', '1 extra bag, 20 kg in total'],
          seats: ['seat not chosen yet', 'seat 13A'],
        },
        {
          fullName: 'Test Infant',
          type: 'Infant',
          passport: '*****02Y',
          extraBaggage: ['no extra bags', 'no extra bags'],
          seats: ['no seat (infant)', 'no seat (infant)'],
        },
      ],
    };

    expect(passengerLines(roundTrip)).toEqual([
      'Test Adult (Adult), passport *****01X',
      '   Outbound: seat not chosen yet, no extra bags',
      '   Return: seat 13A, 1 extra bag, 20 kg in total',
      'Test Infant (Infant), passport *****02Y',
      '   Outbound: no seat (infant), no extra bags',
      '   Return: no seat (infant), no extra bags',
    ]);
  });

  it('says "seat not chosen yet" for a leg that has no seat line', () => {
    const lines = passengerLines({
      ...ticket,
      passengers: [{ ...ticket.passengers[0], seats: [] }],
    });

    expect(lines[1]).toBe('   Outbound: seat not chosen yet, no extra bags');
  });
});

describe('renderETicket (FLT-23)', () => {
  it('returns a PDF', async () => {
    const pdf = await renderETicket(ticket);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
  });

  it('names the reference in the document title', async () => {
    const pdf = await renderETicket(ticket);

    // The page text is compressed; the document information is not.
    expect(pdf.toString('latin1')).toContain('E-ticket FB-7KQ2MX');
  });
});
