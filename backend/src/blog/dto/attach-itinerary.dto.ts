import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, ValidateIf } from 'class-validator';

/**
 * BLG-13: attach one of your own public itineraries to your post, or remove
 * it. The key is required: an id attaches (or replaces) the itinerary, `null`
 * removes it. A missing key answers 400, never a silent detach.
 */
export class AttachItineraryDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '6741c0ffee0ddba11ad0b0b0',
    description:
      'The id of one of your own public itineraries, which replaces any itinerary attached before; `null` removes the attached itinerary. Required.',
  })
  // `null` means "detach" and skips the id check; anything else, a missing
  // key included, must be an id.
  @ValidateIf((dto: AttachItineraryDto) => dto.itineraryId !== null)
  @IsMongoId({ message: 'itineraryId must be an itinerary id or null' })
  itineraryId: string | null;
}
