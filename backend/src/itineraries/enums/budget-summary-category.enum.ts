import { BudgetCategory } from './budget-category.enum';

/**
 * ITN-14: the lines of the budget summary. The four budget entry categories,
 * plus intercity transport, which is not a budget entry category: it is the
 * transport costs of ITN-16. Activity costs (ITN-10) count under activities.
 */
export enum BudgetSummaryCategory {
  Food = BudgetCategory.Food,
  Accommodation = BudgetCategory.Accommodation,
  LocalTransport = BudgetCategory.LocalTransport,
  Activities = BudgetCategory.Activities,
  IntercityTransport = 'intercity_transport',
}

/** The summary lines in the order they are always returned. */
export const BUDGET_SUMMARY_CATEGORIES: readonly BudgetSummaryCategory[] = [
  BudgetSummaryCategory.Food,
  BudgetSummaryCategory.Accommodation,
  BudgetSummaryCategory.LocalTransport,
  BudgetSummaryCategory.Activities,
  BudgetSummaryCategory.IntercityTransport,
];

/** The summary line each budget entry category counts under. */
export const SUMMARY_CATEGORY_OF: Readonly<
  Record<BudgetCategory, BudgetSummaryCategory>
> = {
  [BudgetCategory.Food]: BudgetSummaryCategory.Food,
  [BudgetCategory.Accommodation]: BudgetSummaryCategory.Accommodation,
  [BudgetCategory.LocalTransport]: BudgetSummaryCategory.LocalTransport,
  [BudgetCategory.Activities]: BudgetSummaryCategory.Activities,
};
