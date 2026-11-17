import { ApiProperty } from '@nestjs/swagger';

export class RoomAvailabilityResponseDto {
  @ApiProperty({
    description: 'First bookable night, inclusive, in YYYY-MM-DD format',
    example: '2026-12-01',
  })
  from: string;

  @ApiProperty({
    description: 'Checkout boundary, exclusive, in YYYY-MM-DD format',
    example: '2026-12-08',
  })
  to: string;
}
