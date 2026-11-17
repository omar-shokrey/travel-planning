import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Max, Min } from 'class-validator';
import { ITINERARY_MAX_DAYS } from '../itineraries.constants';

/** ITN-08: move one day to a new position. The other days shift to make room. */
export class MoveDayDto {
  @ApiProperty({
    description: 'Id of the day to move',
    example: '6741c0ffee0ddba11ad0d0d0',
  })
  @IsMongoId({
    message: 'dayId must be a valid id (24 hexadecimal characters)',
  })
  dayId: string;

  @ApiProperty({
    description:
      'The new day number of that day, from 1 to the number of days in the itinerary',
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(ITINERARY_MAX_DAYS)
  position: number;
}
