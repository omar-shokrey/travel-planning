import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityImageResponseDto } from './activity-image-response.dto';
import { MoneyResponseDto } from './money-response.dto';

/** ITN-10, ITN-12: an activity of a day, as the API returns it. */
export class ActivityResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0a0a0' })
  id: string;

  @ApiProperty({ example: 'Egyptian Museum' })
  name: string;

  @ApiPropertyOptional({ example: 'Two hours, book tickets online' })
  description?: string;

  @ApiPropertyOptional({ description: 'HH:mm', example: '09:30' })
  time?: string;

  @ApiPropertyOptional({
    description: 'Whole minor units (cents)',
    example: 20000,
  })
  cost?: number;

  @ApiPropertyOptional({ example: 'EGP' })
  currency?: string;

  @ApiProperty({
    type: [ActivityImageResponseDto],
    description:
      'ITN-12: up to 5 JPG or PNG images (GEN-08), in the order they were added. Always a list, empty when there are none.',
  })
  images: ActivityImageResponseDto[];

  @ApiPropertyOptional({
    type: MoneyResponseDto,
    nullable: true,
    description:
      'ITN-18. Only when you open your itinerary (GET /api/itineraries/:id): the same cost in your preferred currency (USD when you have none), at the rates in `conversion`. Only on an activity with a cost; `null` when its currency has no rate.',
    example: { amount: 4500, currency: 'USD' },
  })
  converted?: MoneyResponseDto | null;
}
