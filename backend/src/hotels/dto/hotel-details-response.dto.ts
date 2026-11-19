import { ApiProperty } from '@nestjs/swagger';
import { AvailableRoomResponseDto } from './available-room-response.dto';
import { HotelPolicyResponseDto } from './hotel-policy-response.dto';
import { HotelResponseDto } from './hotel-response.dto';

/**
 * The hotel page: the profile plus the hotel's policies (HTL-02, HTL-09,
 * HTL-10), and the free rooms when dates are given (HTL-15).
 */
export class HotelDetailsResponseDto extends HotelResponseDto {
  @ApiProperty({
    type: HotelPolicyResponseDto,
    nullable: true,
    description:
      'Check-in and check-out times and the cancellation policy. `null` until the hotel moderator sets them.',
  })
  policy: HotelPolicyResponseDto | null;

  @ApiProperty({
    type: [AvailableRoomResponseDto],
    nullable: true,
    description:
      'HTL-15. The rooms that are free for the whole stay, by room number, when `checkIn` and `checkOut` are sent. `null` when no dates are sent.',
  })
  availableRooms: AvailableRoomResponseDto[] | null;
}
