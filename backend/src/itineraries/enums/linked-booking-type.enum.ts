import { BudgetSummaryCategory } from './budget-summary-category.enum';

/**
 * ITN-27: the kind of booking linked to a day. The same values as the payments
 * module's `BookingType`, kept local so this module does not import payments.
 */
export enum LinkedBookingType {
  Flight = 'flight',
  Hotel = 'hotel',
}

/**
 * ITN-27: the budget summary line a linked booking counts under. A flight is
 * transport between cities; a hotel reservation is accommodation. Not stored
 * on the link, so it can never disagree with the type.
 */
export const LINKED_BOOKING_CATEGORY: Readonly<
  Record<LinkedBookingType, BudgetSummaryCategory>
> = {
  [LinkedBookingType.Flight]: BudgetSummaryCategory.IntercityTransport,
  [LinkedBookingType.Hotel]: BudgetSummaryCategory.Accommodation,
};
