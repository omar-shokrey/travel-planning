import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ReservationGroup } from '../enums/reservation-group.enum';

/** HTL-20: the query of GET /api/hotel-bookings. */
export class HotelReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ReservationGroup,
    enumName: 'ReservationGroup',
    description:
      'Only this group. Upcoming: confirmed, check-out today (UTC) or later. Past: completed, or confirmed with a check-out before today. Cancelled: cancelled. Without it, every reservation of the three groups is listed. A reservation that waits for payment or whose hold ran out is in no group.',
    example: ReservationGroup.Upcoming,
  })
  @IsOptional()
  @IsEnum(ReservationGroup, {
    message: `group must be one of: ${Object.values(ReservationGroup).join(', ')}`,
  })
  group?: ReservationGroup;
}
