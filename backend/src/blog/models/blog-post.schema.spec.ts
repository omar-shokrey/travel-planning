import { BlogPost, BlogPostSchema } from './blog-post.schema';

describe('BlogPostSchema', () => {
  it('should define the required fields', () => {
    const paths = BlogPostSchema.paths;

    expect(paths.authorId).toBeDefined();
    expect(paths.title).toBeDefined();
    expect(paths.body).toBeDefined();
    expect(paths.tags).toBeDefined();
    expect(paths.images).toBeDefined();
    expect(paths.status).toBeDefined();
    expect(paths.likeCount).toBeDefined();
    expect(paths.commentCount).toBeDefined();
    expect(paths.moderation).toBeDefined();
    expect(paths.authorDeactivated).toBeDefined();
    expect(paths.publishedAt).toBeDefined();
  });

  it('should define the BLG-12 author published-post index', () => {
    const indexes = BlogPostSchema.indexes();

    expect(indexes).toContainEqual([
      {
        authorId: 1,
        status: 1,
        moderation: 1,
        publishedAt: -1,
        _id: -1,
      },
      {},
    ]);
  });

  it('should export the BlogPost model class', () => {
    expect(BlogPost).toBeDefined();
  });
});
