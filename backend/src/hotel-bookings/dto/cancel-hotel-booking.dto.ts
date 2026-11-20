import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsInt, Max, Min } from 'class-validator';

/**
 * HTL-21: the confirmation of a cancellation. The user sends the refund
 * percent they were shown (GET /api/hotel-bookings/:id/cancel): if it is no
 * longer the refund (a tier boundary passed in between), the cancellation is
 * refused, so the user never gets a refund other than the one confirmed.
 */
export class CancelHotelBookingDto {
  @ApiProperty({
    description:
      'The refundPercent shown by GET /api/hotel-bookings/:id/cancel, a whole number from 0 to 100',
    minimum: 0,
    maximum: 100,
    example: 50,
  })
  @IsDefined({ message: 'expectedRefundPercent is required' })
  @IsInt({ message: 'expectedRefundPercent must be a whole number' })
  @Min(0, { message: 'expectedRefundPercent must be 0 or more' })
  @Max(100, { message: 'expectedRefundPercent must be at most 100' })
  expectedRefundPercent: number;
}
