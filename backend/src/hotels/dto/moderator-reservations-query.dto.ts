import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ModeratorReservationStatus } from '../hotel-booking-lookup.service';

/** HTL-22: the query of GET /api/hotels/:id/reservations. */
export class ModeratorReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ModeratorReservationStatus,
    enumName: 'ModeratorReservationStatus',
    description:
      'Only reservations in this status. Without it: confirmed, completed and cancelled. A reservation waiting for payment or whose hold ran out is never listed.',
    example: ModeratorReservationStatus.Confirmed,
  })
  @IsOptional()
  @IsEnum(ModeratorReservationStatus, {
    message: `status must be one of: ${Object.values(ModeratorReservationStatus).join(', ')}`,
  })
  status?: ModeratorReservationStatus;
}
