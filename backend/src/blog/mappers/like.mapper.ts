import type { LikeResponseDto } from '../dto/like-response.dto';

/**
 * Builds the like response from the post's id, whether the user likes it now,
 * and the post's like counter. A counter can never be shown below zero.
 */
export function toLikeResponse(
  postId: string,
  liked: boolean,
  likeCount: number | undefined,
): LikeResponseDto {
  return {
    postId,
    liked,
    likeCount: Math.max(0, likeCount ?? 0),
  };
}
