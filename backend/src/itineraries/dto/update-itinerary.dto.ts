import { PartialType } from '@nestjs/swagger';
import { CreateItineraryDto } from './create-itinerary.dto';

/** ITN-01: edit the title, the countries or the start date. Send only what changes. */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {}
