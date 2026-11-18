import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { BudgetCategory } from '../enums/budget-category.enum';
import {
  CURRENCY_CODE_PATTERN,
  MONEY_AMOUNT_MAX,
} from '../itineraries.constants';

/**
 * ITN-14: one budget line of a day. Intercity transport is not a category
 * here: it is a transport cost (ITN-16).
 */
export class CreateBudgetEntryDto {
  @ApiProperty({
    enum: BudgetCategory,
    description:
      'food, accommodation, local_transport (in-city transport) or activities',
    example: BudgetCategory.Food,
  })
  @IsEnum(BudgetCategory, {
    message: `category must be one of: ${Object.values(BudgetCategory).join(', ')}`,
  })
  category: BudgetCategory;

  @ApiProperty({
    description: `Whole minor units (cents), 0 to ${MONEY_AMOUNT_MAX}`,
    example: 45000,
    minimum: 0,
    maximum: MONEY_AMOUNT_MAX,
  })
  @IsInt({ message: 'amount must be a whole number of minor units' })
  @Min(0)
  @Max(MONEY_AMOUNT_MAX)
  amount: number;

  @ApiProperty({
    description: 'Currency of the amount, one of the supported currencies',
    example: 'EGP',
  })
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN, {
    message: 'currency must be a 3-letter currency code such as EGP',
  })
  currency: string;
}
