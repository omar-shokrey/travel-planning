import { ApiProperty } from '@nestjs/swagger';
import { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';

/** HTL-21: the refund of a cancellation, shown before the user confirms. */
export class HotelBookingCancellationPreviewDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90aaa' })
  bookingId: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2027-06-15' })
  checkIn: string;

  @ApiProperty({
    description:
      'Whole days from today (UTC) to the check-in date: the number the tiers compare (HTL-10)',
    example: 12,
  })
  daysRemaining: number;

  @ApiProperty({
    description:
      "The refund in percent, from the hotel's tiers copied into the reservation when it was made",
    example: 50,
  })
  refundPercent: number;

  @ApiProperty({
    description: 'What was paid for every room, in minor units',
    example: 52500,
  })
  total: number;

  @ApiProperty({
    description:
      'The refund in minor units: total × refundPercent / 100, rounded',
    example: 26250,
  })
  refundAmount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

/** HTL-21: a cancelled reservation and its refund. */
export class HotelBookingCancellationResponseDto extends HotelBookingCancellationPreviewDto {
  @ApiProperty({
    enum: HotelBookingStatus,
    enumName: 'HotelBookingStatus',
    example: HotelBookingStatus.Cancelled,
  })
  status: HotelBookingStatus;

  @ApiProperty({
    description: 'When the reservation was cancelled, UTC',
    example: '2027-06-03T10:00:00.000Z',
  })
  cancelledAt: string;

  @ApiProperty({
    type: RefundSummaryDto,
    nullable: true,
    description:
      'The refund through Stripe (PAY-03) with its status; `null` when nothing is refunded (0%)',
  })
  refund: RefundSummaryDto | null;
}
