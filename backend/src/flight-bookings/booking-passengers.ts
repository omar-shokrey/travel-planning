import type { FieldError } from '../common/interfaces/error-response.interface';
import type { PassengerDetailsDto } from './dto/hold-flight-booking.dto';
import { PassengerType } from './enums/passenger-type.enum';
import {
  ADULT_MIN_AGE,
  CHILD_MIN_AGE,
  FLIGHT_BOOKING_ADULTS_MIN,
  FLIGHT_BOOKING_SEATS_MAX,
  INFANT_ON_RETURN_MESSAGE,
  RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE,
} from './flight-bookings.constants';
import {
  countByType,
  passengerTypeOn,
  type PassengerCountsByType,
} from './passenger-types';

/**
 * The extra-bag rule that applies to a booking: the airline's price and
 * maximum (FLT-08) and the cabin's maximum weight of one bag (FLT-04).
 * `maxBagKg` is unknown only when the flight has no such cabin, which the
 * seat hold then answers with 404.
 */
export interface BaggageRule {
  extraBagPrice?: number;
  maxExtraBags: number;
  maxBagKg?: number;
}

/** One passenger as the booking stores it, with the fee of their extra bags. */
export interface PlannedPassenger {
  fullName: string;
  dateOfBirth: string;
  passportNumber: string;
  type: PassengerType;
  extraBags?: { bags: number; weightKg: number };
  /** Minor units: bags × the airline's extra bag price, 0 without bags. */
  baggageFee: number;
}

export interface PassengerPlan {
  passengers: PlannedPassenger[];
  counts: PassengerCountsByType;
  /** Adults and children: infants take no seat (FLT-12). */
  seats: number;
  /** Minor units: the fees of every passenger. */
  baggageTotal: number;
}

export type PassengerPlanResult =
  { plan: PassengerPlan; errors: [] } | { plan: null; errors: FieldError[] };

export const NO_ADULT_MESSAGE = `A booking needs at least one adult (${ADULT_MIN_AGE} or older on the departure date)`;
export const TOO_MANY_INFANTS_MESSAGE = `A booking cannot have more infants (younger than ${CHILD_MIN_AGE} on the departure date) than adults`;
export const TOO_MANY_SEATS_MESSAGE = `A booking has at most ${FLIGHT_BOOKING_SEATS_MAX} seats (adults and children)`;
export const DUPLICATE_PASSPORT_MESSAGE =
  'Each passenger of a booking needs a different passport number';
export const NO_EXTRA_BAGS_MESSAGE = 'This airline sells no extra bags';
export const BORN_AFTER_DEPARTURE_MESSAGE =
  "dateOfBirth cannot be after the flight's departure date";
export const tooManyBagsMessage = (max: number): string =>
  `This airline allows at most ${max} extra bag(s) per passenger`;
export const tooHeavyMessage = (bags: number, maxBagKg: number): string =>
  `weightKg must be at most ${bags * maxBagKg} (${bags} bag(s) of at most ${maxBagKg} kg each)`;

/**
 * FLT-19: the fee of one passenger's extra bags on one flight, or 0. Extra
 * bags only from an airline that sells them (a price and a maximum above 0),
 * at most its maximum, and a total weight of at most bags × the cabin's
 * maximum weight of one bag. A broken rule is reported at `path` (the
 * `extraBags` or `returnExtraBags` of a passenger) and costs 0.
 */
export function feeOfExtraBags(
  extraBags: { bags: number; weightKg: number } | undefined,
  rule: BaggageRule,
  path: string,
  add: (field: string, message: string) => void,
): number {
  if (!extraBags) {
    return 0;
  }
  const sellsBags =
    rule.extraBagPrice !== undefined &&
    rule.extraBagPrice !== null &&
    rule.maxExtraBags > 0;
  if (!sellsBags) {
    add(path, NO_EXTRA_BAGS_MESSAGE);
  } else if (extraBags.bags > rule.maxExtraBags) {
    add(`${path}.bags`, tooManyBagsMessage(rule.maxExtraBags));
  } else if (
    rule.maxBagKg !== undefined &&
    extraBags.weightKg > extraBags.bags * rule.maxBagKg
  ) {
    add(`${path}.weightKg`, tooHeavyMessage(extraBags.bags, rule.maxBagKg));
  } else {
    return extraBags.bags * (rule.extraBagPrice as number);
  }
  return 0;
}

/**
 * FLT-19 and FLT-12(b): checks the passengers of a booking and prices their
 * extra bags, before anything is held.
 *
 * - The type of each passenger comes from the date of birth on the flight's
 *   local departure date: adult 12+, child 2 to 11, infant under 2.
 * - At least one adult, no more infants than adults, at most 9 adults and
 *   children together.
 * - Every passport number of the booking is different.
 * - Extra bags only from an airline that sells them (a price and a maximum
 *   above 0), at most its maximum, and a total weight of at most bags × the
 *   cabin's maximum weight of one bag. The fee is bags × the price.
 *
 * Every error has the path of the field the standard 400 body uses, such as
 * `passengers.1.extraBags.weightKg`. No message repeats a personal value.
 */
export function planPassengers(
  input: readonly PassengerDetailsDto[],
  departureDateLocal: string,
  rule: BaggageRule,
): PassengerPlanResult {
  const errors: FieldError[] = [];
  const add = (field: string, message: string) =>
    errors.push({ field, messages: [message] });

  const seenPassports = new Set<string>();

  const passengers = input.map((passenger, index): PlannedPassenger => {
    const path = `passengers.${index}`;
    // Today (UTC) can be one day after the local departure date at an
    // airport west of UTC: someone born today is not born yet on the flight.
    if (passenger.dateOfBirth > departureDateLocal) {
      add(`${path}.dateOfBirth`, BORN_AFTER_DEPARTURE_MESSAGE);
    }
    if (seenPassports.has(passenger.passportNumber)) {
      add(`${path}.passportNumber`, DUPLICATE_PASSPORT_MESSAGE);
    }
    seenPassports.add(passenger.passportNumber);

    const extraBags = passenger.extraBags ?? undefined;
    const baggageFee = feeOfExtraBags(
      extraBags,
      rule,
      `${path}.extraBags`,
      add,
    );

    return {
      fullName: passenger.fullName,
      dateOfBirth: passenger.dateOfBirth,
      passportNumber: passenger.passportNumber,
      type: passengerTypeOn(passenger.dateOfBirth, departureDateLocal),
      ...(extraBags
        ? {
            extraBags: {
              bags: extraBags.bags,
              weightKg: extraBags.weightKg,
            },
          }
        : {}),
      baggageFee,
    };
  });

  const counts = countByType(passengers.map(({ type }) => type));
  const seats = counts.adults + counts.children;
  if (counts.adults < FLIGHT_BOOKING_ADULTS_MIN) {
    add('passengers', NO_ADULT_MESSAGE);
  }
  if (counts.infants > counts.adults) {
    add('passengers', TOO_MANY_INFANTS_MESSAGE);
  }
  if (seats > FLIGHT_BOOKING_SEATS_MAX) {
    add('passengers', TOO_MANY_SEATS_MESSAGE);
  }

  if (errors.length > 0) {
    return { plan: null, errors };
  }
  return {
    plan: {
      passengers,
      counts,
      seats,
      baggageTotal: passengers.reduce(
        (sum, { baggageFee }) => sum + baggageFee,
        0,
      ),
    },
    errors: [],
  };
}

/** One passenger on the return flight of a round trip (FLT-12(a)). */
export interface PlannedReturnPassenger {
  type: PassengerType;
  extraBags?: { bags: number; weightKg: number };
  /** Minor units: bags × the return airline's extra bag price, 0 without bags. */
  baggageFee: number;
}

export type ReturnPlanResult =
  | { passengers: PlannedReturnPassenger[]; errors: [] }
  | { passengers: null; errors: FieldError[] };

/**
 * FLT-12(a): the return flight of a round trip, for the same passengers.
 *
 * - The type of each passenger stays the one of the outbound date (a booking
 *   stores one type per passenger), so the seats and the counts are the same
 *   on both flights. An infant outbound who is 2 or older on the return date
 *   would need a seat on it: 400 on that passenger's `dateOfBirth`.
 * - `returnExtraBags` follows the rules of `extraBags`, with the return
 *   airline's price and maximum and the return cabin's bag weight (the two
 *   directions can be different airlines, data model).
 *
 * `types` are the outbound types, in the order of `input`. Every error has the
 * path of its field. No message repeats a personal value.
 */
export function planReturnPassengers(
  input: readonly PassengerDetailsDto[],
  types: readonly PassengerType[],
  returnDateLocal: string,
  rule: BaggageRule,
): ReturnPlanResult {
  const errors: FieldError[] = [];
  const add = (field: string, message: string) =>
    errors.push({ field, messages: [message] });

  const passengers = input.map((passenger, index): PlannedReturnPassenger => {
    const path = `passengers.${index}`;
    const type = types[index];
    if (
      type === PassengerType.Infant &&
      passengerTypeOn(passenger.dateOfBirth, returnDateLocal) !==
        PassengerType.Infant
    ) {
      add(`${path}.dateOfBirth`, INFANT_ON_RETURN_MESSAGE);
    }
    const extraBags = passenger.returnExtraBags ?? undefined;
    const baggageFee = feeOfExtraBags(
      extraBags,
      rule,
      `${path}.returnExtraBags`,
      add,
    );
    return {
      type,
      ...(extraBags
        ? { extraBags: { bags: extraBags.bags, weightKg: extraBags.weightKg } }
        : {}),
      baggageFee,
    };
  });

  return errors.length > 0
    ? { passengers: null, errors }
    : { passengers, errors: [] };
}

/**
 * FLT-12(a): `returnExtraBags` only makes sense with a return flight. The
 * errors for a one-way booking whose passengers send it, one per passenger.
 */
export function returnBagsWithoutReturnFlight(
  input: readonly PassengerDetailsDto[],
): FieldError[] {
  return input.flatMap((passenger, index) =>
    passenger.returnExtraBags === undefined ||
    passenger.returnExtraBags === null
      ? []
      : [
          {
            field: `passengers.${index}.returnExtraBags`,
            messages: [RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE],
          },
        ],
  );
}
