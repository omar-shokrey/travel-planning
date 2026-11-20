import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FlightBookingGroup } from '../enums/flight-booking-group.enum';

/** FLT-25: one list of the user's flight bookings, a page at a time. */
export class ListFlightBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FlightBookingGroup,
    enumName: 'FlightBookingGroup',
    default: FlightBookingGroup.Upcoming,
    description:
      'upcoming (soonest first), past (latest first) or cancelled (latest cancellation first)',
  })
  @IsOptional()
  @IsEnum(FlightBookingGroup, {
    message: 'group must be one of: upcoming, past, cancelled',
  })
  group: FlightBookingGroup = FlightBookingGroup.Upcoming;
}
