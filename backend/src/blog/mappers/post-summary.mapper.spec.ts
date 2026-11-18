import { PostSummaryMapper } from './post-summary.mapper';

describe('PostSummaryMapper', () => {
  it('should map only the allowed post summary fields', () => {
    const post = {
      _id: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      authorId: {
        toString: () => '507f191e810c19729de860ea',
      },
      title: 'My Travel Story',
      publishedAt: new Date('2026-01-15T10:30:00.000Z'),
      body: 'This must not be returned',
      tags: ['travel'],
      images: ['image.jpg'],
      status: 'published',
      moderation: 'visible',
      likeCount: 20,
      commentCount: 5,
      secretField: 'must not appear',
    };

    const result = PostSummaryMapper.toResponse(post);

    expect(result).toEqual({
      id: '507f1f77bcf86cd799439011',
      authorId: '507f191e810c19729de860ea',
      title: 'My Travel Story',
      publishedAt: '2026-01-15T10:30:00.000Z',
    });

    expect(Object.keys(result).sort()).toEqual([
      'authorId',
      'id',
      'publishedAt',
      'title',
    ]);
  });

  it('should reject a post without publishedAt', () => {
    const post = {
      _id: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      authorId: {
        toString: () => '507f191e810c19729de860ea',
      },
      title: 'Draft Post',
    };

    expect(() => PostSummaryMapper.toResponse(post)).toThrow(
      'Published post must have publishedAt',
    );
  });
});
