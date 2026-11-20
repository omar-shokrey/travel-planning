import { ApiProperty } from '@nestjs/swagger';
import { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';

/** FLT-26: the refund of a cancellation, shown before the user confirms. */
export class FlightBookingCancellationPreviewDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90aaa' })
  bookingId: string;

  @ApiProperty({
    description: 'UTC departure of the first flight, ending in Z',
    example: '2027-06-15T08:00:00.000Z',
  })
  departureAt: string;

  @ApiProperty({
    description:
      'Whole days from now to the departure, rounded down: the number the tiers compare (FLT-09)',
    example: 12,
  })
  daysRemaining: number;

  @ApiProperty({
    description:
      "The refund in percent, from the airline's tiers copied into the booking (the outbound flight's for a round trip)",
    example: 50,
  })
  refundPercent: number;

  @ApiProperty({
    description: 'What was paid, in minor units',
    example: 52500,
  })
  total: number;

  @ApiProperty({
    description:
      'The refund in minor units: refundPercent of each payment of the booking, each rounded (total × refundPercent for a booking never changed to a dearer flight, FLT-27)',
    example: 26250,
  })
  refundAmount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

/** FLT-26: a cancelled booking and its refund. */
export class FlightBookingCancellationResponseDto extends FlightBookingCancellationPreviewDto {
  @ApiProperty({ example: 'cancelled' })
  status: string;

  @ApiProperty({
    description: 'When the booking was cancelled, UTC',
    example: '2027-06-03T10:00:00.000Z',
  })
  cancelledAt: string;

  @ApiProperty({
    type: RefundSummaryDto,
    nullable: true,
    description:
      "The refund of the booking's payment through Stripe (PAY-03) with its status; `null` when nothing is refunded (0%)",
  })
  refund: RefundSummaryDto | null;

  @ApiProperty({
    type: [RefundSummaryDto],
    description:
      'FLT-27: the refunds of the fare differences paid for dearer flight changes, at the same percent; empty when there were none',
  })
  changeRefunds: RefundSummaryDto[];
}
