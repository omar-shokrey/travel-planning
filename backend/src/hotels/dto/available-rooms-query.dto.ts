import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsBeforeDate, IsDateOnly } from './date-only.validators';

const CHECK_IN_DESCRIPTION =
  'Check-in date (the first night) in YYYY-MM-DD format. Cannot be in the past (UTC).';
const CHECK_OUT_DESCRIPTION =
  'Check-out date in YYYY-MM-DD format. Must be after the check-in date; at most 366 nights later.';

/** HTL-15: the searched stay, and the page of free rooms. */
export class AvailableRoomsQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: CHECK_IN_DESCRIPTION, example: '2026-12-10' })
  @IsDateOnly('checkIn')
  @IsBeforeDate('checkOut')
  checkIn: string;

  @ApiProperty({ description: CHECK_OUT_DESCRIPTION, example: '2026-12-13' })
  @IsDateOnly('checkOut')
  checkOut: string;
}

/** Whether either date was sent: then both are required. */
const datesSent = (query: HotelDetailsQueryDto): boolean =>
  query.checkIn !== undefined || query.checkOut !== undefined;

/**
 * HTL-02: the hotel page takes the stay as optional dates. With both, the page
 * also lists the rooms that are free for the whole stay (HTL-15).
 */
export class HotelDetailsQueryDto {
  @ApiPropertyOptional({
    description: `${CHECK_IN_DESCRIPTION} Send it with checkOut to see the free rooms.`,
    example: '2026-12-10',
  })
  @ValidateIf(datesSent)
  @IsDateOnly('checkIn')
  @IsBeforeDate('checkOut')
  checkIn?: string;

  @ApiPropertyOptional({
    description: `${CHECK_OUT_DESCRIPTION} Send it with checkIn.`,
    example: '2026-12-13',
  })
  @ValidateIf(datesSent)
  @IsDateOnly('checkOut')
  checkOut?: string;
}
