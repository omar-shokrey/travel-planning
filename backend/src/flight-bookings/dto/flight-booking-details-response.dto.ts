import { ApiProperty } from '@nestjs/swagger';
import { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import { CancelledBy } from '../enums/cancelled-by.enum';
import { SegmentSeatsResponseDto } from './booking-seats-response.dto';
import { FlightChangeSummaryDto } from './flight-change-response.dto';
import { FlightBookingResponseDto } from './flight-booking-response.dto';

/**
 * FLT-25: the full details of one of the user's bookings: the booking as the
 * hold returned it, the flight of each segment, the policy acceptance and,
 * once cancelled, who cancelled it, the refund percent and the refund. With
 * FLT-28, the seat of each passenger on each segment; with FLT-27, its flight
 * changes.
 */
export class FlightBookingDetailsResponseDto extends FlightBookingResponseDto {
  @ApiProperty({
    type: FlightResponseDto,
    isArray: true,
    description:
      'The flight of each segment, in the order of `segments`; an item is null only if that flight no longer exists',
  })
  flights: (FlightResponseDto | null)[];

  @ApiProperty({ type: String, nullable: true, example: null })
  policyAcceptedAt: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelledAt: string | null;

  @ApiProperty({
    enum: CancelledBy,
    enumName: 'CancelledBy',
    nullable: true,
    example: null,
  })
  cancelledBy: CancelledBy | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'The refund percent applied when it was cancelled',
  })
  refundPercent: number | null;

  @ApiProperty({
    type: RefundSummaryDto,
    nullable: true,
    description: 'The refund (PAY-03), if one was made',
  })
  refund: RefundSummaryDto | null;

  @ApiProperty({
    type: [SegmentSeatsResponseDto],
    description:
      'FLT-28: one entry per segment, in segment order, with the seat of each passenger who takes one',
  })
  seats: SegmentSeatsResponseDto[];

  @ApiProperty({
    type: FlightChangeSummaryDto,
    nullable: true,
    description:
      'FLT-27: the flight change waiting for its payment (pay it before its `holdExpiresAt`), or `null`',
  })
  pendingChange: FlightChangeSummaryDto | null;

  @ApiProperty({
    type: [FlightChangeSummaryDto],
    description:
      'FLT-27: every flight change of the booking, newest first, each with its refund',
  })
  changes: FlightChangeSummaryDto[];
}
