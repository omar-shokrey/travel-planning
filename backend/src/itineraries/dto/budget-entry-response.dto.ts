import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MoneyResponseDto } from './money-response.dto';
import { BudgetCategory } from '../enums/budget-category.enum';

/** ITN-14: a budget entry of a day, as the API returns it. */
export class BudgetEntryResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0b0b0' })
  id: string;

  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.Food })
  category: BudgetCategory;

  @ApiProperty({ description: 'Whole minor units (cents)', example: 45000 })
  amount: number;

  @ApiProperty({ example: 'EGP' })
  currency: string;

  @ApiPropertyOptional({
    type: MoneyResponseDto,
    nullable: true,
    description:
      'ITN-18. Only when you open your itinerary (GET /api/itineraries/:id): the same amount in your preferred currency (USD when you have none), at the rates in `conversion`. `null` when the currency has no rate.',
    example: { amount: 4500, currency: 'USD' },
  })
  converted?: MoneyResponseDto | null;
}
