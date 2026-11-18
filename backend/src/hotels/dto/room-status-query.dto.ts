import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsBeforeDate, IsDateOnly } from './date-only.validators';

/** HTL-08: the date range of the room status view, and the page of rooms. */
export class RoomStatusQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'First night of the range, inclusive, in YYYY-MM-DD format',
    example: '2026-12-01',
  })
  @IsDateOnly('from')
  @IsBeforeDate('to')
  from: string;

  @ApiProperty({
    description:
      'End of the range, exclusive (the day after the last night), in YYYY-MM-DD format. At most 366 nights after `from`.',
    example: '2026-12-15',
  })
  @IsDateOnly('to')
  to: string;
}
