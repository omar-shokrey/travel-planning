import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MoneyResponseDto } from './money-response.dto';

/** ITN-09: consecutive days in the same city, shown together. */
export class CityGroupResponseDto {
  @ApiProperty({ description: 'City id from the city list', example: 'cairo' })
  cityId: string;

  @ApiProperty({
    description: 'Number of the first day in the group',
    example: 1,
  })
  firstDayNumber: number;

  @ApiProperty({
    description: 'Number of the last day in the group',
    example: 3,
  })
  lastDayNumber: number;

  @ApiProperty({ description: 'Date of the first day', example: '2026-12-20' })
  startDate: string;

  @ApiProperty({ description: 'Date of the last day', example: '2026-12-22' })
  endDate: string;

  @ApiProperty({ description: 'Number of days in the group', example: 3 })
  dayCount: number;

  @ApiProperty({
    description:
      'Budget subtotal of the group: activity costs, budget entries and transport costs of its days, one total per currency, sorted by currency. The budget summary gives these totals in your currency (ITN-18).',
    type: [MoneyResponseDto],
    example: [{ amount: 45000, currency: 'EGP' }],
  })
  budgetSubtotal: MoneyResponseDto[];

  @ApiPropertyOptional({
    type: MoneyResponseDto,
    nullable: true,
    description:
      'ITN-18. Only when you open your itinerary (GET /api/itineraries/:id): the subtotal as one amount in your preferred currency. `null` when a currency of the group has no rate.',
    example: { amount: 340500, currency: 'EGP' },
  })
  budgetSubtotalConverted?: MoneyResponseDto | null;
}
