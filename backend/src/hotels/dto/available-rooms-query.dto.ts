import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ROOM_QUERY_MAX_NIGHTS } from '../hotels.constants';
import { IsBeforeDate, IsDateOnly } from './date-only.validators';

/** The check-in date as Swagger describes it (HTL-15, HTL-02). */
export const CHECK_IN_DESCRIPTION =
  'Check-in date (the first night), YYYY-MM-DD. Today (UTC) or later.';

/** The check-out date as Swagger describes it (HTL-15, HTL-02). */
export const CHECK_OUT_DESCRIPTION = `Check-out date (the day after the last night), YYYY-MM-DD. After checkIn, at most ${ROOM_QUERY_MAX_NIGHTS} nights later.`;

/**
 * HTL-15: the searched stay, and the page of free rooms. The service also
 * checks that check-in is not in the past and that the stay is not too long,
 * with the same rules and messages as hotel search (`assertStay`).
 */
export class AvailableRoomsQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: CHECK_IN_DESCRIPTION, example: '2026-12-10' })
  @IsDateOnly('checkIn')
  @IsBeforeDate('checkOut')
  checkIn: string;

  @ApiProperty({ description: CHECK_OUT_DESCRIPTION, example: '2026-12-13' })
  @IsDateOnly('checkOut')
  checkOut: string;
}
