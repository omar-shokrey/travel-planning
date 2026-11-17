import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { HotelBookingGroup } from '../hotel-booking-groups';

/** HTL-20: `GET /api/hotel-bookings?group=upcoming&page=1&limit=10`. */
export class ListHotelBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: HotelBookingGroup,
    enumName: 'HotelBookingGroup',
    description:
      '`upcoming`: confirmed and check-out not passed, or waiting for payment with a live hold (soonest first). `past`: completed, or confirmed with check-out passed (latest first). `cancelled`: cancelled (latest first). Leave it out for every reservation, expired ones included, newest first.',
  })
  @IsOptional()
  @IsEnum(HotelBookingGroup, {
    message: 'group must be upcoming, past or cancelled',
  })
  group?: HotelBookingGroup;
}
