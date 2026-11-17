import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';

/** HTL-22: `GET /api/hotels/:id/reservations?status=confirmed&page=1`. */
export class HotelReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: HotelBookingStatus,
    enumName: 'HotelBookingStatus',
    description:
      'Only reservations in this status. Leave it out for every reservation except `expired` ones (holds that were never paid).',
  })
  @IsOptional()
  @IsEnum(HotelBookingStatus, {
    message:
      'status must be pending_payment, confirmed, completed, expired or cancelled',
  })
  status?: HotelBookingStatus;
}
