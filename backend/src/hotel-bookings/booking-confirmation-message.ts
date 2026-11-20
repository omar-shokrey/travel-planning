/** The facts of a confirmed reservation the message shows. */
export interface ConfirmedStay {
  reference: string;
  hotelName: string;
  /** `YYYY-MM-DD`: a date without a time, shown as stored. */
  checkIn: string;
  /** `YYYY-MM-DD`. */
  checkOut: string;
  nights: number;
  rooms: readonly {
    roomLabel: string;
    adults: number;
    childAges: readonly number[];
  }[];
}

const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count} ${count === 1 ? word : many}`;

/**
 * HTL-17: the text of the in-app notification of a confirmed reservation
 * (GEN-01): the reference, the hotel, the dates as stored (no time zone can
 * shift a `YYYY-MM-DD` date), the nights, each room and the guests. For
 * example "Your reservation HB-7KQ2MX at Nile Hotel is confirmed: check-in
 * 2027-06-15, check-out 2027-06-18 (3 nights), 2 rooms (101 (Double), 102
 * (Family)), 3 adults and 1 child." No guest name is in the text.
 */
export function reservationConfirmedMessage(stay: ConfirmedStay): string {
  const adults = stay.rooms.reduce((sum, room) => sum + room.adults, 0);
  const children = stay.rooms.reduce(
    (sum, room) => sum + room.childAges.length,
    0,
  );
  const guests =
    children > 0
      ? `${plural(adults, 'adult')} and ${plural(children, 'child', 'children')}`
      : plural(adults, 'adult');
  const rooms = `${plural(stay.rooms.length, 'room')} (${stay.rooms
    .map((room) => room.roomLabel)
    .join(', ')})`;
  return `Your reservation ${stay.reference} at ${stay.hotelName} is confirmed: check-in ${stay.checkIn}, check-out ${stay.checkOut} (${plural(stay.nights, 'night')}), ${rooms}, ${guests}.`;
}
