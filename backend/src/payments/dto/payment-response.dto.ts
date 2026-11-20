import { ApiProperty } from '@nestjs/swagger';
import { BookingType } from '../enums/booking-type.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

/** A payment as the API returns it (PAY-01): the public fields only. */
export class PaymentResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  id: string;

  @ApiProperty({ enum: BookingType, enumName: 'BookingType' })
  bookingType: BookingType;

  @ApiProperty({
    description:
      'Id of the booking, or of the flight change for `flight_change` (FLT-27)',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  bookingId: string;

  @ApiProperty({
    description: 'The Stripe PaymentIntent id',
    example: 'pi_3Pq1Xx2eZvKYlo2C0abcd123',
  })
  stripePaymentIntentId: string;

  @ApiProperty({
    description: 'Whole minor units of the platform currency',
    example: 52500,
  })
  amount: number;

  @ApiProperty({
    description: 'The platform currency (PAY-04)',
    example: 'USD',
  })
  currency: string;

  @ApiProperty({
    enum: PaymentStatus,
    enumName: 'PaymentStatus',
    description:
      '`requires_payment`: waiting for the card. `succeeded`: the webhook verified the payment. `failed`: the last attempt failed, retry it. `cancelled`: the hold ended',
  })
  status: PaymentStatus;

  @ApiProperty({
    description:
      'End of the booking hold: the payment must succeed before it (UTC)',
    example: '2026-11-20T10:10:00.000Z',
  })
  holdExpiresAt: string;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-20T10:02:00.000Z' })
  updatedAt: string;
}

/**
 * A payment that is ready to be confirmed in the browser. The client secret is
 * given only to the owner, when the payment is created or retried, and is read
 * from Stripe each time: the database never stores it.
 */
export class PaymentIntentResponseDto extends PaymentResponseDto {
  @ApiProperty({
    description:
      'Give it to Stripe Elements (`stripe.confirmPayment`) in the frontend. It is a secret of this payment: show it to nobody else and never log it',
    example: 'pi_3Pq1Xx2eZvKYlo2C0abcd123_secret_xxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  clientSecret: string;
}

/** The answer of the webhook: Stripe only needs a 2xx. */
export class WebhookResponseDto {
  @ApiProperty({ example: true })
  received: boolean;
}
