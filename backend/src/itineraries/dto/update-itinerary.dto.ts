import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ItineraryVisibility } from '../enums/itinerary-visibility.enum';
import { CreateItineraryDto } from './create-itinerary.dto';

/**
 * ITN-01: edit the title, the countries or the start date.
 * ITN-20: make the itinerary public or private.
 * Send only what changes.
 */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {
  @ApiPropertyOptional({
    description:
      'public: the itinerary appears in the shared search and others can read it. private: only the owner sees it.',
    enum: ItineraryVisibility,
    example: ItineraryVisibility.Public,
  })
  @IsOptional()
  @IsEnum(ItineraryVisibility, {
    message: 'visibility must be public or private',
  })
  visibility?: ItineraryVisibility;
}
