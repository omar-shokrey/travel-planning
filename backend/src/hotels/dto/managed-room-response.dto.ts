import { ApiProperty } from '@nestjs/swagger';
import { RoomAvailabilityResponseDto } from './room-availability-response.dto';
import { RoomResponseDto } from './room-response.dto';

/**
 * A room as its hotel moderator sees it (HTL-05, HTL-06): the room of HTL-03
 * and HTL-04 plus the date ranges the moderator blocked.
 */
export class ManagedRoomResponseDto extends RoomResponseDto {
  @ApiProperty({
    type: [RoomAvailabilityResponseDto],
    description:
      'The blocked date ranges, first night first. `to` is the day after the last blocked night.',
    example: [{ from: '2026-12-10', to: '2026-12-12' }],
  })
  blocked: RoomAvailabilityResponseDto[];
}
