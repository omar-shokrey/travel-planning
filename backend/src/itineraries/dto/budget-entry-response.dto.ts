import { ApiProperty } from '@nestjs/swagger';
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
}
