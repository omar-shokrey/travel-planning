/**
 * GEN-10: the moderation state an admin sets on a post, a comment or an
 * itinerary (`PATCH /api/admin/content/:type/:id`). The same two values as
 * `PostModeration`, `CommentModeration` and `ItineraryModeration` in their
 * modules.
 */
export enum ContentModeration {
  Visible = 'visible',
  Hidden = 'hidden',
}
