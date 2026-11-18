import type { CommentResponseDto } from '../dto/comment-response.dto';
import { CommentModeration } from '../models/comment-moderation.enum';
import type { CommentDocument } from '../models/comment.schema';

/** Turns a stored comment into the public response. */
export function toCommentResponse(
  comment: CommentDocument,
): CommentResponseDto {
  return {
    id: comment.id as string,
    postId: comment.postId.toString(),
    authorId: comment.authorId.toString(),
    body: comment.body,
    // GEN-10: the author, who still edits a hidden comment, is told it is
    // hidden. A comment stored before the field existed is visible.
    moderation: comment.moderation ?? CommentModeration.Visible,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
