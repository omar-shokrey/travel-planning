import { BadRequestException } from '@nestjs/common';
import { ROOM_QUERY_MAX_NIGHTS } from './hotels.constants';
import { nightCount, todayUtc, type DateRange } from './room-dates';

/** A 400 in the shape of a validation error, naming the field. */
export const invalid = (field: string, message: string): BadRequestException =>
  new BadRequestException({
    message: 'Validation failed',
    errors: [{ field, messages: [message] }],
  });

/**
 * The rules of a searched stay that the query DTO cannot check, shared by
 * hotel search (HTL-11), the free rooms of a hotel (HTL-15) and the hotel page
 * (HTL-02), so the three answer the same 400 for the same stay. Check-in
 * cannot be before today (UTC): "today" changes, so it is checked here and not
 * in the DTO. A stay has at most `ROOM_QUERY_MAX_NIGHTS` nights. That
 * check-out is after check-in is checked by the DTO (`IsBeforeDate`).
 */
export function assertStay(stay: DateRange): void {
  if (stay.from < todayUtc()) {
    throw invalid('checkIn', 'checkIn cannot be in the past');
  }
  if (nightCount(stay) > ROOM_QUERY_MAX_NIGHTS) {
    throw invalid(
      'checkOut',
      `A stay can have at most ${ROOM_QUERY_MAX_NIGHTS} nights`,
    );
  }
}
