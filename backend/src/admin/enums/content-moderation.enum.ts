/**
 * GEN-10: the moderation state an admin sets on a post or an itinerary
 * (`PATCH /api/admin/content/:type/:id`). The same two values as
 * `PostModeration` and `ItineraryModeration` in their modules.
 */
export enum ContentModeration {
  Visible = 'visible',
  Hidden = 'hidden',
}
