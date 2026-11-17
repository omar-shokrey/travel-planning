import { ApiProperty } from '@nestjs/swagger';
import { ItineraryModeration } from '../enums/itinerary-moderation.enum';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';

/** An itinerary as the API returns it. */
export class ItineraryResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0c0de' })
  id: string;

  @ApiProperty({ example: '6741c0ffee0ddba11ad0beef' })
  ownerId: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries: string[];

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({
    enum: ItineraryVisibility,
    example: ItineraryVisibility.Private,
  })
  visibility: ItineraryVisibility;

  @ApiProperty({
    description:
      'hidden: an admin hid it (GEN-10). Only its owner and admins still see it, and it is left out of public search even when public.',
    enum: ItineraryModeration,
    example: ItineraryModeration.Visible,
  })
  moderation: ItineraryModeration;

  @ApiProperty({ description: 'Number of days in the itinerary', example: 0 })
  dayCount: number;
}
