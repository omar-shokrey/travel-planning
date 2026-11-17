import { ApiProperty } from '@nestjs/swagger';
import { HotelPolicyResponseDto } from './hotel-policy-response.dto';
import { HotelResponseDto } from './hotel-response.dto';

/** The hotel page: the profile plus the hotel's policies (HTL-02, HTL-09, HTL-10). */
export class HotelDetailsResponseDto extends HotelResponseDto {
  @ApiProperty({
    type: HotelPolicyResponseDto,
    nullable: true,
    description:
      'Check-in and check-out times and the cancellation policy. `null` until the hotel moderator sets them.',
  })
  policy: HotelPolicyResponseDto | null;
}
