import { ApiProperty } from '@nestjs/swagger';
import { BudgetSummaryCategory } from '../enums/budget-summary-category.enum';
import { MoneyResponseDto } from './money-response.dto';

const PER_CURRENCY =
  'One amount per currency, in whole minor units, sorted by currency code. These are the amounts as entered; `converted` is the same total in your currency (ITN-18).';

const CONVERTED =
  'ITN-18: the same total in your preferred currency (ACC-09, USD when you have none), in whole minor units, at the rates of `conversion.rateDate`. Each currency is converted and rounded on its own, then added, so converted lines can differ from the converted total by a few minor units. `null` when there are no rates or a currency has no rate (see `conversion.missingCurrencies`).';

/** ITN-18: which rates converted the summary. */
export class BudgetConversionResponseDto {
  @ApiProperty({
    example: 'EGP',
    description:
      'Your preferred currency (ACC-09), or USD when you have not chosen one',
  })
  currency: string;

  @ApiProperty({
    example: '2026-11-19',
    description: 'The date of the exchange rates used (`YYYY-MM-DD`)',
  })
  rateDate: string;

  @ApiProperty({
    example: '2026-11-19T06:00:00.000Z',
    description: 'When the rates were fetched from FXRatesAPI',
  })
  fetchedAt: string;

  @ApiProperty({
    type: [String],
    example: [],
    description:
      'Currencies of the itinerary, or your currency, that have no rate. Totals that need one of them have `converted: null`.',
  })
  missingCurrencies: string[];
}

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

  @ApiProperty({
    type: MoneyResponseDto,
    nullable: true,
    description: CONVERTED,
    example: { amount: 45000, currency: 'EGP' },
  })
  converted: MoneyResponseDto | null;
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
    type: MoneyResponseDto,
    nullable: true,
    description: CONVERTED,
  })
  converted: MoneyResponseDto | null;

  @ApiProperty({
    type: [BudgetCategoryTotalResponseDto],
    description: 'Always the five lines, in the same order as `byCategory`',
  })
  byCategory: BudgetCategoryTotalResponseDto[];
}

/**
 * ITN-14: the total budget of an itinerary, by category and by day. Every
 * total is a list of amounts per currency, and ITN-18 adds the same total
 * converted to the user's currency next to it.
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
    type: MoneyResponseDto,
    nullable: true,
    description: CONVERTED,
    example: { amount: 340500, currency: 'EGP' },
  })
  converted: MoneyResponseDto | null;

  @ApiProperty({
    type: BudgetConversionResponseDto,
    nullable: true,
    description:
      'ITN-18: the currency and the rates used. `null` only when no exchange rates were ever fetched; then every `converted` is `null`.',
  })
  conversion: BudgetConversionResponseDto | null;

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
