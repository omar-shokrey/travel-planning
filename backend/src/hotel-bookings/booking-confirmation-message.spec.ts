import { reservationConfirmedMessage } from './booking-confirmation-message';

describe('reservationConfirmedMessage (HTL-17)', () => {
  it('names the reference, the hotel, the dates as stored, the nights, the rooms and the guests', () => {
    expect(
      reservationConfirmedMessage({
        reference: 'HB-7KQ2MX',
        hotelName: 'Nile Hotel',
        checkIn: '2027-06-15',
        checkOut: '2027-06-18',
        nights: 3,
        rooms: [
          { roomLabel: '101 (Double)', adults: 2, childAges: [] },
          { roomLabel: '102 (Family)', adults: 1, childAges: [7] },
        ],
      }),
    ).toBe(
      'Your reservation HB-7KQ2MX at Nile Hotel is confirmed: check-in 2027-06-15, check-out 2027-06-18 (3 nights), 2 rooms (101 (Double), 102 (Family)), 3 adults and 1 child.',
    );
  });

  it('uses the singular for one room, one night and one adult, and leaves out children when there are none', () => {
    expect(
      reservationConfirmedMessage({
        reference: 'HB-7KQ2MX',
        hotelName: 'Nile Hotel',
        checkIn: '2027-12-31',
        checkOut: '2028-01-01',
        nights: 1,
        rooms: [{ roomLabel: '101 (Single)', adults: 1, childAges: [] }],
      }),
    ).toBe(
      'Your reservation HB-7KQ2MX at Nile Hotel is confirmed: check-in 2027-12-31, check-out 2028-01-01 (1 night), 1 room (101 (Single)), 1 adult.',
    );
  });

  it('counts several children', () => {
    expect(
      reservationConfirmedMessage({
        reference: 'HB-7KQ2MX',
        hotelName: 'Nile Hotel',
        checkIn: '2027-06-15',
        checkOut: '2027-06-16',
        nights: 1,
        rooms: [{ roomLabel: '102 (Family)', adults: 2, childAges: [0, 17] }],
      }),
    ).toMatch(/, 2 adults and 2 children\.$/);
  });
});
