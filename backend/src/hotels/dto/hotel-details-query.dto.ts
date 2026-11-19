import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import {
  CHECK_IN_DESCRIPTION,
  CHECK_OUT_DESCRIPTION,
} from './available-rooms-query.dto';
import { IsBeforeDate, IsDateOnly } from './date-only.validators';

/** Whether either date was sent: then both are required. */
const datesSent = (query: HotelDetailsQueryDto): boolean =>
  query.checkIn !== undefined || query.checkOut !== undefined;

/**
 * HTL-02: the hotel page takes the stay as optional dates. With both, the page
 * also lists the rooms that are free for the whole stay (HTL-15); with only
 * one, the request answers 400.
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
