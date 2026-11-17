/**
 * Whether a review is shown (GEN-10). An admin can hide it; hidden content
 * is visible only to its author and admins. One enum per module, as the
 * admin README explains.
 */
export enum ReviewModeration {
  Visible = 'visible',
  Hidden = 'hidden',
}
