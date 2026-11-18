import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ROOM_AVAILABILITY_RANGES_MAX_COUNT } from '../hotels.constants';
import { CreateRoomAvailabilityDto } from './create-room-availability.dto';

/**
 * Validate a list whenever it was sent. `@IsOptional()` would also skip
 * `null`, and `null` is never a valid list here.
 */
const whenSent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * What a hotel moderator sends to edit a room's calendar: the bookable date
 * ranges (HTL-05), the blocked date ranges (HTL-06), or both. Each list that
 * is sent replaces the old one; a list that is left out stays as it is.
 */
export class SetRoomAvailabilityDto {
  @ApiPropertyOptional({
    type: [CreateRoomAvailabilityDto],
    description:
      'HTL-05. Every date range in which the room is bookable. `from` is the first night and `to` the checkout boundary (not included). The ranges must not overlap; they may touch. An empty list makes the room unbookable.',
    example: [
      { from: '2026-12-01', to: '2026-12-08' },
      { from: '2026-12-20', to: '2027-01-05' },
    ],
    maxItems: ROOM_AVAILABILITY_RANGES_MAX_COUNT,
  })
  @ValidateIf(whenSent)
  @IsArray({ message: 'availability must be a list' })
  @ArrayMaxSize(ROOM_AVAILABILITY_RANGES_MAX_COUNT, {
    message: `availability must have at most ${ROOM_AVAILABILITY_RANGES_MAX_COUNT} ranges`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateRoomAvailabilityDto)
  availability?: CreateRoomAvailabilityDto[];

  @ApiPropertyOptional({
    type: [CreateRoomAvailabilityDto],
    description:
      'HTL-06. Every date range in which the room is blocked, for example for repairs. Same `from` and `to` rules as `availability`. An empty list removes every block. A night that a reservation has booked, or holds while it waits for payment, cannot be blocked.',
    example: [{ from: '2026-12-10', to: '2026-12-12' }],
    maxItems: ROOM_AVAILABILITY_RANGES_MAX_COUNT,
  })
  @ValidateIf(whenSent)
  @IsArray({ message: 'blocked must be a list' })
  @ArrayMaxSize(ROOM_AVAILABILITY_RANGES_MAX_COUNT, {
    message: `blocked must have at most ${ROOM_AVAILABILITY_RANGES_MAX_COUNT} ranges`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateRoomAvailabilityDto)
  blocked?: CreateRoomAvailabilityDto[];
}
