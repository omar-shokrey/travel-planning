import type { CommentResponseDto } from '../dto/comment-response.dto';
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
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
