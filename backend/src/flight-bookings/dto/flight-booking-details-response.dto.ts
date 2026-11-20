import { ApiProperty } from '@nestjs/swagger';
import { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import { CancelledBy } from '../enums/cancelled-by.enum';
import { FlightBookingResponseDto } from './flight-booking-response.dto';

/**
 * FLT-25: the full details of one of the user's bookings: the booking as the
 * hold returned it, the flight of each segment, the policy acceptance and,
 * once cancelled, who cancelled it, the refund percent and the refund.
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
}
