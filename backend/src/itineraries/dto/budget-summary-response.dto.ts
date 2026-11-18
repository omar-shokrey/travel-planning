import { ApiProperty } from '@nestjs/swagger';
import { BudgetSummaryCategory } from '../enums/budget-summary-category.enum';
import { MoneyResponseDto } from './money-response.dto';

const PER_CURRENCY =
  'One amount per currency, in whole minor units, sorted by currency code. Nothing is converted (conversion is ITN-18).';

/** ITN-14: what one summary line adds up to. */
export class BudgetCategoryTotalResponseDto {
  @ApiProperty({
    enum: BudgetSummaryCategory,
    description:
      'food, accommodation and local_transport are budget entries; activities is budget entries plus activity costs (ITN-10); intercity_transport is the transport costs (ITN-16)',
    example: BudgetSummaryCategory.Food,
  })
  category: BudgetSummaryCategory;

  @ApiProperty({
    type: [MoneyResponseDto],
    description: `${PER_CURRENCY} Empty when the line has nothing.`,
    example: [{ amount: 45000, currency: 'EGP' }],
  })
  total: MoneyResponseDto[];
}

/** ITN-14: what one day adds up to. */
export class BudgetDayTotalResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0d0d0' })
  dayId: string;

  @ApiProperty({ example: 1 })
  dayNumber: number;

  @ApiProperty({ example: '2026-12-20' })
  date: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ type: [MoneyResponseDto], description: PER_CURRENCY })
  total: MoneyResponseDto[];

  @ApiProperty({
    type: [BudgetCategoryTotalResponseDto],
    description: 'Always the five lines, in the same order as `byCategory`',
  })
  byCategory: BudgetCategoryTotalResponseDto[];
}

/**
 * ITN-14: the total budget of an itinerary, by category and by day. Every
 * total is a list of amounts per currency. ITN-18 can add converted totals
 * next to these fields without changing them.
 */
export class BudgetSummaryResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0a0a0' })
  itineraryId: string;

  @ApiProperty({
    type: [MoneyResponseDto],
    description: PER_CURRENCY,
    example: [
      { amount: 120000, currency: 'EGP' },
      { amount: 4500, currency: 'USD' },
    ],
  })
  total: MoneyResponseDto[];

  @ApiProperty({
    type: [BudgetCategoryTotalResponseDto],
    description:
      'Always five lines, in this order: food, accommodation, local_transport, activities, intercity_transport. They add up to `total`.',
  })
  byCategory: BudgetCategoryTotalResponseDto[];

  @ApiProperty({
    type: [BudgetDayTotalResponseDto],
    description: 'Every day in order. The days add up to `total`.',
  })
  byDay: BudgetDayTotalResponseDto[];
}
