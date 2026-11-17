import { ApiProperty } from '@nestjs/swagger';

/** ITN-21: the itinerary a clone was copied from, and its author's credit. */
export class CloneSourceResponseDto {
  @ApiProperty({
    description: 'Id of the original. It may have been deleted since.',
    example: '6741c0ffee0ddba11ad0c0de',
  })
  itineraryId: string;

  @ApiProperty({ example: '6741c0ffee0ddba11ad0beef' })
  authorId: string;

  @ApiProperty({
    description: 'The name of the original author when the clone was made',
    example: 'Sara Ahmed',
  })
  authorName: string;
}
