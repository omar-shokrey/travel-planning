/**
 * HTL-23: whether a review counts and is shown (data model: "visible or
 * hidden"). Every review starts visible; hiding one is a moderation action
 * of a later issue. Only visible reviews make the hotel's rating.
 */
export enum ReviewModeration {
  Visible = 'visible',
  Hidden = 'hidden',
}
