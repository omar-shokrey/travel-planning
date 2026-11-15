import { ApiProperty } from '@nestjs/swagger';
import { ItineraryDayResponseDto } from './itinerary-day-response.dto';
import { ItineraryResponseDto } from './itinerary-response.dto';

/** ITN-03: an itinerary with its days, in order. */
export class ItineraryDetailResponseDto extends ItineraryResponseDto {
  @ApiProperty({ type: [ItineraryDayResponseDto] })
  days: ItineraryDayResponseDto[];
}
