import { ApiProperty } from '@nestjs/swagger';

/** One cancellation tier as the API returns it (FLT-09). */
export class CancellationTierResponseDto {
  @ApiProperty({
    description: 'Threshold in whole days before departure',
    example: 7,
    minimum: 0,
  })
  daysBefore: number;

  @ApiProperty({
    description:
      'Refund in percent of the booking total, for a cancellation at least `daysBefore` days before departure',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  refundPercent: number;
}
