import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsInt,
  IsMongoId,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  EXPECTED_DIFFERENCE_REQUIRED_MESSAGE,
  FLIGHT_BOOKING_SEGMENTS_MAX,
  POLICIES_REQUIRED_MESSAGE,
} from '../flight-bookings.constants';

/** A change, as opposed to a dry run: `dryRun` left out or false (null is refused). */
const isRealChange = (body: ChangeFlightDto): boolean => body.dryRun !== true;

/**
 * FLT-27: PATCH /api/flight-bookings/:id/change-flight. Change one flight of
 * the owner's confirmed booking to another flight on the same route, in the
 * same cabin. First with `dryRun: true` to see the price difference and the
 * new airline's policies; then without it, sending back the difference that
 * was shown and accepting the policies. The cabin, the price, the owner and
 * the status are never sent: the server sets them.
 */
export class ChangeFlightDto {
  @ApiProperty({
    description:
      'The flight to change to: same departure and arrival airports as the booked flight, with the booked cabin',
    example: '6740f1c2a4b5c6d7e8f90abc',
  })
  @IsMongoId({ message: 'newFlightId must be a valid id' })
  newFlightId: string;

  @ApiPropertyOptional({
    description:
      'Which flight of the booking: 0 the outbound, 1 the return. Required for a round trip; a one-way booking may leave it out.',
    minimum: 0,
    maximum: FLIGHT_BOOKING_SEGMENTS_MAX - 1,
    example: 0,
  })
  // Only a sent value is checked, so null answers 400 instead of meaning "left out".
  @ValidateIf((body: ChangeFlightDto) => body.segmentIndex !== undefined)
  @IsInt({ message: 'segmentIndex must be a whole number' })
  @Min(0, { message: 'segmentIndex must be 0 or more' })
  @Max(FLIGHT_BOOKING_SEGMENTS_MAX - 1, {
    message: `segmentIndex must be at most ${FLIGHT_BOOKING_SEGMENTS_MAX - 1}`,
  })
  segmentIndex?: number;

  @ApiPropertyOptional({
    description:
      'true: only show the price difference and the new policies, changing nothing. Left out or false: make the change.',
    example: true,
  })
  @ValidateIf((body: ChangeFlightDto) => body.dryRun !== undefined)
  @IsBoolean({ message: 'dryRun must be true or false' })
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Required to make the change: the `difference` the dry run showed, in minor units (above 0 to pay, below 0 refunded, 0 nothing). If the difference is no longer this, the change is refused (409) and nothing changes.',
    example: 4200,
  })
  @ValidateIf(isRealChange)
  @IsDefined({ message: EXPECTED_DIFFERENCE_REQUIRED_MESSAGE })
  @IsInt({ message: 'expectedDifference must be a whole number' })
  expectedDifference?: number;

  @ApiPropertyOptional({
    description:
      "Required to make the change, and must be true: the user accepts the new airline's cancellation tiers and bag rules, which replace the old ones for this flight (PAY-02)",
    example: true,
  })
  @ValidateIf(isRealChange)
  @Equals(true, { message: POLICIES_REQUIRED_MESSAGE })
  policiesAccepted?: boolean;
}
