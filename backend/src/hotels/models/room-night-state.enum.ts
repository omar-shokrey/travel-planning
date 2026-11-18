/** Why a room is not free on one night (the `room_nights` collection). */
export enum RoomNightState {
  /** A reservation in Pending Payment holds the night until the hold expires. */
  Held = 'held',
  /** A Confirmed reservation has the night. */
  Booked = 'booked',
  /** The hotel moderator blocked the night (HTL-06). */
  Blocked = 'blocked',
}
