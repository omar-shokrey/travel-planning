import { ApiProperty } from '@nestjs/swagger';
import { BookingType } from '../../enums/booking-type.enum';
import { RefundReason } from '../enums/refund-reason.enum';
import { RefundStatus } from '../enums/refund-status.enum';

/** PAY-03: a refund as its owner sees it. Never the owner id. */
export class RefundResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90aaa' })
  id: string;

  @ApiProperty({
    enum: BookingType,
    enumName: 'BookingType',
    example: BookingType.Flight,
  })
  bookingType: BookingType;

  @ApiProperty({
    description:
      'Id of the booking, or of the flight change for `flight_change` (FLT-27)',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  bookingId: string;

  @ApiProperty({
    description: 'The payment the money is refunded from',
    example: '6740f1c2a4b5c6d7e8f90bbb',
  })
  paymentId: string;

  @ApiProperty({
    description: 'Minor units of `currency`',
    example: 12550,
  })
  amount: number;

  @ApiProperty({ description: 'The payment currency', example: 'USD' })
  currency: string;

  @ApiProperty({
    description:
      'Share refunded, 1 to 100: of what was left of the payment for a cancellation or a late payment, of the whole payment (rounded) for a fare difference',
    example: 50,
  })
  refundPercent: number;

  @ApiProperty({
    enum: RefundReason,
    enumName: 'RefundReason',
    example: RefundReason.UserCancellation,
  })
  reason: RefundReason;

  @ApiProperty({
    enum: RefundStatus,
    enumName: 'RefundStatus',
    description:
      '`pending` until Stripe confirms; `refunded` and `failed` are final',
    example: RefundStatus.Pending,
  })
  status: RefundStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Stripe's refund id; `null` until Stripe took the refund",
    example: 're_3Q4abcd1234',
  })
  stripeRefundId: string | null;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-20T10:00:05.000Z' })
  updatedAt: string;
}

/** PAY-03: the refund as the booking details show it (FLT-25, the hotel details). */
export class RefundSummaryDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90aaa' })
  id: string;

  @ApiProperty({
    enum: RefundStatus,
    enumName: 'RefundStatus',
    example: RefundStatus.Refunded,
  })
  status: RefundStatus;

  @ApiProperty({ description: 'Minor units of `currency`', example: 12550 })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 50 })
  refundPercent: number;
}
