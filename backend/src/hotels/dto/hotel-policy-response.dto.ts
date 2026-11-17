import { ApiProperty } from '@nestjs/swagger';

/** The policies of a hotel as the API returns them (HTL-09). */
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
}
