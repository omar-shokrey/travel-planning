import {
  type ETicket,
  formatMoney,
  maskPassport,
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
    },
  ],
  seats: 1,
  totalPaid: 'USD 250.00',
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
