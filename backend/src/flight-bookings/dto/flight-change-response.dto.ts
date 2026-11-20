import { ApiProperty } from '@nestjs/swagger';
import { FlightResponseDto } from '../../flights/dto/flight-response.dto';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightSegmentPoliciesDto } from '../../payments/dto/booking-policies-response.dto';
import { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import { FlightChangeStatus } from '../enums/flight-change-status.enum';

/** FLT-27: what PATCH change-flight answers: a dry run's quote, or a stored change's status. */
export const FLIGHT_CHANGE_ANSWER_STATUSES = [
  'quote',
  ...Object.values(FlightChangeStatus),
] as const;
export type FlightChangeAnswerStatus =
  (typeof FLIGHT_CHANGE_ANSWER_STATUSES)[number];

/** FLT-27: how to pay the fare difference of a dearer flight (PAY-01). */
export class FlightChangePaymentDto {
  @ApiProperty({
    example: 'flight_change',
    description: 'Send it as `bookingType` to POST /api/payments',
  })
  bookingType: 'flight_change';

  @ApiProperty({
    example: '6740f1c2a4b5c6d7e8f90ccc',
    description: 'The id of the change; send it as `bookingId`',
  })
  bookingId: string;
}

/**
 * FLT-27: the answer of PATCH /api/flight-bookings/:id/change-flight: the
 * quote of a dry run (`status: quote`, `id: null`), or the change made.
 */
export class FlightChangeResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '6740f1c2a4b5c6d7e8f90ccc',
    description: 'The id of the change; `null` for a dry run',
  })
  id: string | null;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90aaa' })
  bookingId: string;

  @ApiProperty({
    enum: FLIGHT_CHANGE_ANSWER_STATUSES,
    enumName: 'FlightChangeAnswerStatus',
    description:
      '`quote` (dry run, nothing changed), `pending_payment` (dearer: pay the difference before `holdExpiresAt`), `completed` (equal or cheaper: the booking flies the new flight now)',
    example: 'quote',
  })
  status: FlightChangeAnswerStatus;

  @ApiProperty({
    example: 0,
    description: '0 the outbound flight, 1 the return flight',
  })
  segmentIndex: number;

  @ApiProperty({ enum: CabinClass, enumName: 'CabinClass' })
  cabin: CabinClass;

  @ApiProperty({
    type: FlightResponseDto,
    nullable: true,
    description: 'The booked flight (null only if it no longer exists)',
  })
  fromFlight: FlightResponseDto | null;

  @ApiProperty({
    type: FlightResponseDto,
    description: 'The new flight, with local times (GEN-06)',
  })
  toFlight: FlightResponseDto;

  @ApiProperty({
    example: 25000,
    description:
      'Minor units: what the booked flight costs in this booking (fares of every seat and infant, plus the extra bags on it)',
  })
  oldSegmentTotal: number;

  @ApiProperty({
    example: 29200,
    description: 'Minor units: the same on the new flight',
  })
  newSegmentTotal: number;

  @ApiProperty({
    example: 4200,
    description:
      'Minor units: `newSegmentTotal - oldSegmentTotal`. Above 0 is paid with Stripe, below 0 is refunded to the card, 0 changes the flight at once.',
  })
  difference: number;

  @ApiProperty({
    example: 56700,
    description: "Minor units: the booking's total once the change is made",
  })
  newTotal: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: FlightSegmentPoliciesDto,
    description:
      "The new airline's cancellation tiers and the new flight's bag rules, which replace the old ones for this flight once the change is made",
  })
  newPolicies: FlightSegmentPoliciesDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-20T10:10:00.000Z',
    description:
      'A dearer flight: until when its seats are held for the payment (UTC). `null` otherwise.',
  })
  holdExpiresAt: string | null;

  @ApiProperty({
    type: FlightChangePaymentDto,
    nullable: true,
    description:
      'A dearer flight waiting for payment: what to send to POST /api/payments. `null` otherwise.',
  })
  payment: FlightChangePaymentDto | null;

  @ApiProperty({
    type: RefundSummaryDto,
    nullable: true,
    description: 'A cheaper flight: the refund of the difference (PAY-03)',
  })
  refund: RefundSummaryDto | null;
}

/** FLT-27: one change of a booking, as the booking details and lists show it. */
export class FlightChangeSummaryDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90ccc' })
  id: string;

  @ApiProperty({
    enum: FlightChangeStatus,
    enumName: 'FlightChangeStatus',
  })
  status: FlightChangeStatus;

  @ApiProperty({ example: 0 })
  segmentIndex: number;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  fromFlightId: string;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  toFlightId: string;

  @ApiProperty({
    example: 4200,
    description:
      'Minor units: above 0 paid, below 0 refunded, 0 neither (see `difference` of the change route)',
  })
  difference: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'UTC end of the seat hold while the change waits for payment; `null` otherwise',
  })
  holdExpiresAt: string | null;

  @ApiProperty({ example: '2026-11-19T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  completedAt: string | null;

  @ApiProperty({
    type: RefundSummaryDto,
    nullable: true,
    description:
      'The refund of a cheaper flight (PAY-03). Only on the booking details; `null` in a list.',
  })
  refund: RefundSummaryDto | null;
}
