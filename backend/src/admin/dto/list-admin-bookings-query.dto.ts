import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, ValidateBy } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsDateOnly } from '../../hotels/dto/date-only.validators';
import { BookingType } from '../../payments/enums/booking-type.enum';
import {
  ADMIN_BOOKING_STATUSES,
  type AdminBookingStatus,
  BOOKING_RANGE_ORDER_MESSAGE,
} from '../admin-bookings.constants';

/**
 * `from` is not after `to`. Two `YYYY-MM-DD` strings compare correctly as
 * plain text. Without a `to` (or with an invalid one, which its own rule
 * rejects) there is nothing to compare.
 */
const IsNotAfterTo = (): PropertyDecorator =>
  ValidateBy({
    name: 'isNotAfterTo',
    validator: {
      validate: (value: unknown, args): boolean => {
        const to = (args?.object as { to?: unknown } | undefined)?.to;
        return (
          typeof value !== 'string' || typeof to !== 'string' || value <= to
        );
      },
      defaultMessage: (): string => BOOKING_RANGE_ORDER_MESSAGE,
    },
  });

/**
 * `GET /api/admin/bookings?page=1&limit=10&type=flight&status=confirmed&from=2026-11-01&to=2026-11-30`
 * (ACC-17, GEN-05). Every filter is optional; together they must all match.
 * `from` and `to` are the days the bookings were made (`createdAt`, UTC),
 * both included.
 */
export class ListAdminBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Only flight or only hotel bookings. Without it, both.',
    enum: BookingType,
    enumName: 'BookingType',
  })
  @IsOptional()
  @IsEnum(BookingType)
  type?: BookingType;

  @ApiPropertyOptional({
    description: 'Only bookings with this status',
    enum: ADMIN_BOOKING_STATUSES,
    example: 'confirmed',
  })
  @IsOptional()
  @IsIn(ADMIN_BOOKING_STATUSES)
  status?: AdminBookingStatus;

  @ApiPropertyOptional({
    description:
      'Only bookings made on this day or later (UTC), YYYY-MM-DD. It filters when the booking was made (createdAt), not the travel dates.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateOnly('from')
  @IsNotAfterTo()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Only bookings made on this day or earlier (UTC), YYYY-MM-DD, the whole day included. Not before from.',
    example: '2026-11-30',
  })
  @IsOptional()
  @IsDateOnly('to')
  to?: string;
}
