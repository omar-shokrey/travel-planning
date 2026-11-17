import { ApiProperty } from '@nestjs/swagger';

/** ITN-21: who wrote a public itinerary. */
export class AuthorResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0beef' })
  id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;
}
