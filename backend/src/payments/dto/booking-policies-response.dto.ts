import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import {
  BOOKING_KINDS,
  type BookingKind,
  BookingType,
} from '../enums/booking-type.enum';
import { PENDING_PAYMENT } from '../payments.constants';

const BOOKING_STATUSES = [
  PENDING_PAYMENT,
  'confirmed',
  'completed',
  'expired',
  'cancelled',
];

/** One step of a cancellation policy: cancelling at least `daysBefore` days before refunds `refundPercent`. */
export class PolicyCancellationTierDto {
  @ApiProperty({ example: 30 })
  daysBefore: number;

  @ApiProperty({ example: 100, minimum: 0, maximum: 100 })
  refundPercent: number;
}

/** The baggage rule of one flight (FLT-04 free allowance, FLT-08 extra bags). */
export class FlightBaggagePolicyDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Free checked bags per passenger in this cabin; `null` for a booking made before the policy was copied',
    example: 1,
  })
  freeBags: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Maximum weight of one bag in kg, free or extra; `null` for a booking made before the policy was copied',
    example: 23,
  })
  maxBagKg: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Price of one extra bag in minor units of `currency`; `null` when the airline sells no extra bags',
    example: 4500,
  })
  extraBagPrice: number | null;

  @ApiProperty({
    description: 'Most extra bags one passenger may buy; 0 means none',
    example: 2,
  })
  maxExtraBags: number;

  @ApiProperty({ description: 'The platform currency', example: 'USD' })
  currency: string;
}

/** The policies of one flight of the booking, as copied when the seats were held. */
export class FlightSegmentPoliciesDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  flightId: string;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    example: CabinClass.Economy,
  })
  cabin: CabinClass;

  @ApiProperty({
    type: [PolicyCancellationTierDto],
    description:
      "The airline's cancellation tiers, highest `daysBefore` first. Empty means no refund.",
  })
  cancellationTiers: PolicyCancellationTierDto[];

  @ApiProperty({ type: FlightBaggagePolicyDto })
  baggage: FlightBaggagePolicyDto;
}

/** The airline's policies of a flight booking. */
export class FlightPoliciesDto {
  @ApiProperty({ type: [FlightSegmentPoliciesDto] })
  segments: FlightSegmentPoliciesDto[];
}

/** The hotel's policies of a reservation, as copied when it was made (HTL-09, HTL-10). */
export class HotelPoliciesDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Check-in time, HH:mm at the hotel; `null` if the hotel set none',
    example: '14:00',
  })
  checkInTime: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Check-out time, HH:mm at the hotel; `null` if the hotel set none',
    example: '12:00',
  })
  checkOutTime: string | null;

  @ApiProperty({
    type: [PolicyCancellationTierDto],
    description:
      "The hotel's cancellation tiers, highest `daysBefore` first. Empty means no refund.",
  })
  cancellationTiers: PolicyCancellationTierDto[];
}

/** PAY-02: the provider's policies of one booking, shown before payment, and whether they were accepted. */
export class BookingPoliciesResponseDto {
  @ApiProperty({
    enum: BOOKING_KINDS,
    enumName: 'BookingKind',
    example: BookingType.Flight,
  })
  type: BookingKind;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90789' })
  bookingId: string;

  @ApiProperty({ enum: BOOKING_STATUSES, example: PENDING_PAYMENT })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'UTC end of the hold while the booking waits for payment; `null` in any other status',
    example: '2026-11-19T10:10:00.000Z',
  })
  holdExpiresAt: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'UTC moment the user accepted the policies; `null` until then. It never changes once set.',
    example: null,
  })
  policyAcceptedAt: string | null;

  @ApiPropertyOptional({
    type: FlightPoliciesDto,
    description: 'Only for `type: flight`',
  })
  flight?: FlightPoliciesDto;

  @ApiPropertyOptional({
    type: HotelPoliciesDto,
    description: 'Only for `type: hotel`',
  })
  hotel?: HotelPoliciesDto;
}

/** PAY-02 for PAY-01: what may be charged, once the policies are accepted and the hold is live. */
export interface PayableBooking {
  type: BookingKind;
  bookingId: string;
  /** Minor units of `currency`. */
  total: number;
  currency: string;
  holdExpiresAt: Date;
}
