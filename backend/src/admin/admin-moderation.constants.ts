import { ReportTargetType } from '../reports/enums/report-target-type.enum';
import type { ContentModeration } from './enums/content-moderation.enum';

/**
 * `:type` of the content routes (GEN-10) is not one of the `ReportTargetType`
 * values: `post`, `itinerary` or `comment`.
 */
export const CONTENT_TYPE_MESSAGE = `type must be one of: ${Object.values(
  ReportTargetType,
).join(', ')}`;

/** GEN-10: the report is not open any more, or another admin was first. */
export const REPORT_ALREADY_RESOLVED_MESSAGE =
  'This report has already been resolved';

/** GEN-10: the content of a direct moderation route does not exist. */
export const CONTENT_NOT_FOUND_MESSAGE: Record<ReportTargetType, string> = {
  [ReportTargetType.Post]: 'Post not found',
  [ReportTargetType.Itinerary]: 'Itinerary not found',
  [ReportTargetType.Comment]: 'Comment not found',
};

/** GEN-10: hiding a report's content that its author has deleted since. */
export function reportedContentGoneMessage(type: ReportTargetType): string {
  return `The reported ${type} no longer exists, so it cannot be hidden. Dismiss the report or delete it instead.`;
}

/** GEN-10: the content is already in the moderation state that was asked for. */
export function alreadyModeratedMessage(
  type: ReportTargetType,
  moderation: ContentModeration,
): string {
  return `The ${type} is already ${moderation}`;
}
