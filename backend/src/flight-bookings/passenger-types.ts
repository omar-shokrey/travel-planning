import { PassengerType } from './enums/passenger-type.enum';
import { ADULT_MIN_AGE, CHILD_MIN_AGE } from './flight-bookings.constants';

/** "2014-03-09" -> [2014, "03-09"]. Both strings are valid YYYY-MM-DD dates. */
const yearAndDay = (date: string): [number, string] => [
  Number(date.slice(0, 4)),
  date.slice(5),
];

/**
 * Age in whole years on `onDate` of someone born on `dateOfBirth`, both
 * `YYYY-MM-DD` calendar dates, so no time zone is involved. The birthday is
 * reached on the same month and day; a person born on 29 February reaches it
 * on 1 March in a year without 29 February.
 */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [birthYear, birthDay] = yearAndDay(dateOfBirth);
  const [year, day] = yearAndDay(onDate);
  return year - birthYear - (day < birthDay ? 1 : 0);
}

/**
 * FLT-12(b): the passenger type on the flight's local departure date:
 * adult 12 or older, child 2 to 11, infant younger than 2.
 */
export function passengerTypeOn(
  dateOfBirth: string,
  departureDateLocal: string,
): PassengerType {
  const age = ageOn(dateOfBirth, departureDateLocal);
  if (age >= ADULT_MIN_AGE) {
    return PassengerType.Adult;
  }
  return age >= CHILD_MIN_AGE ? PassengerType.Child : PassengerType.Infant;
}

export interface PassengerCountsByType {
  adults: number;
  children: number;
  infants: number;
}

/** How many passengers of each type. */
export function countByType(
  types: readonly PassengerType[],
): PassengerCountsByType {
  return {
    adults: types.filter((type) => type === PassengerType.Adult).length,
    children: types.filter((type) => type === PassengerType.Child).length,
    infants: types.filter((type) => type === PassengerType.Infant).length,
  };
}
