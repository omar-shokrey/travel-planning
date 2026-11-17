import { ApiProperty } from '@nestjs/swagger';

/** One cancellation tier as the API returns it (HTL-10). */
export class CancellationTierResponseDto {
  @ApiProperty({
    description: 'Threshold in whole days before check-in',
    example: 7,
  })
  daysBefore: number;

  @ApiProperty({
    description:
      'Refund in percent of the reservation total, for a cancellation at least `daysBefore` days before check-in',
    example: 50,
  })
  refundPercent: number;
}

/** The policies of a hotel as the API returns them (HTL-09, HTL-10). */
export class HotelPolicyResponseDto {
  @ApiProperty({
    description: 'Standard check-in time, local to the hotel (HH:mm)',
    example: '14:00',
  })
  checkInTime: string;

  @ApiProperty({
    description: 'Standard check-out time, local to the hotel (HH:mm)',
    example: '12:00',
  })
  checkOutTime: string;

  @ApiProperty({
    type: [CancellationTierResponseDto],
    description:
      'The cancellation policy, highest threshold first. A cancellation is refunded by the first tier whose `daysBefore` does not exceed the days remaining before check-in; if none applies, or the list is empty, the refund is 0%.',
    example: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
    ],
  })
  cancellationTiers: CancellationTierResponseDto[];
}
