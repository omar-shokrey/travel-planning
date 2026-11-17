import { toLikeResponse } from './like.mapper';

const POST_ID = '6740a1b2c3d4e5f601234560';

describe('toLikeResponse', () => {
  it('returns the post id, the like state and the like count', () => {
    expect(toLikeResponse(POST_ID, true, 12)).toEqual({
      postId: POST_ID,
      liked: true,
      likeCount: 12,
    });
  });

  it('shows 0 for a post that has no counter yet', () => {
    expect(toLikeResponse(POST_ID, false, undefined).likeCount).toBe(0);
  });

  it('never shows a count below zero', () => {
    expect(toLikeResponse(POST_ID, false, -1).likeCount).toBe(0);
  });
});
