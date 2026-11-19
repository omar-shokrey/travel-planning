/**
 * FLT-12(b): the type of a passenger, derived by the server from the date of
 * birth on the flight's local departure date. The client never sends it.
 */
export enum PassengerType {
  /** 12 or older: pays the fare and takes a seat. */
  Adult = 'adult',
  /** 2 to 11: pays the fare and takes a seat. */
  Child = 'child',
  /** Younger than 2: pays 10% of the fare and takes no seat. */
  Infant = 'infant',
}
