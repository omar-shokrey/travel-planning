import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { ROOM_AVAILABILITY_RANGES_MAX_COUNT } from '../hotels.constants';
import { CreateRoomAvailabilityDto } from './create-room-availability.dto';

/**
 * What a hotel moderator sends to edit a room's availability (HTL-05): the
 * complete new list of bookable date ranges. It replaces the old list, so a
 * range is changed or removed by sending the list without it.
 */
export class SetRoomAvailabilityDto {
  @ApiProperty({
    type: [CreateRoomAvailabilityDto],
    description:
      'Every date range in which the room is bookable. `from` is the first night and `to` the checkout boundary (not included). The ranges must not overlap; they may touch. An empty list makes the room unbookable.',
    example: [
      { from: '2026-12-01', to: '2026-12-08' },
      { from: '2026-12-20', to: '2027-01-05' },
    ],
    maxItems: ROOM_AVAILABILITY_RANGES_MAX_COUNT,
  })
  @IsArray({ message: 'availability must be a list' })
  @ArrayMaxSize(ROOM_AVAILABILITY_RANGES_MAX_COUNT, {
    message: `availability must have at most ${ROOM_AVAILABILITY_RANGES_MAX_COUNT} ranges`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateRoomAvailabilityDto)
  availability: CreateRoomAvailabilityDto[];
}
