import { Mongoose } from 'mongoose';
import { BlogPost, BlogPostSchema } from './blog-post.schema';
import { PostModeration } from './post-moderation.enum';

describe('BlogPostSchema, tag page index (BLG-08, GEN-10)', () => {
  it('covers the tag, the public filter (status, moderation) and the newest-first sort', () => {
    expect(BlogPostSchema.indexes().map(([fields]) => fields)).toContainEqual({
      tags: 1,
      status: 1,
      moderation: 1,
      publishedAt: -1,
      _id: -1,
    });
  });
});

describe('BlogPostSchema, author page index (BLG-12, GEN-10)', () => {
  it('covers the author, the public filter (status, moderation) and the newest-first sort', () => {
    expect(BlogPostSchema.indexes().map(([fields]) => fields)).toContainEqual({
      authorId: 1,
      status: 1,
      moderation: 1,
      publishedAt: -1,
      _id: -1,
    });
  });
});

describe('BlogPostSchema, moderation (GEN-10)', () => {
  it('is visible or hidden, required, and visible by default', () => {
    expect(BlogPostSchema.path('moderation').options).toMatchObject({
      type: String,
      required: true,
      enum: Object.values(PostModeration),
      default: PostModeration.Visible,
    });
  });

  it('gives a new post, and a stored one without the field, moderation visible', () => {
    const mongoose = new Mongoose();
    const PostModel = mongoose.model(BlogPost.name, BlogPostSchema);

    expect(new PostModel({ title: 'T', body: 'B' }).moderation).toBe(
      PostModeration.Visible,
    );
    // A stored post read before the field existed (hydrated, not lean).
    const old = PostModel.hydrate({ title: 'Old', body: 'B' });
    expect(old.moderation).toBe(PostModeration.Visible);
  });

  it('refuses a value that is not visible or hidden', async () => {
    const mongoose = new Mongoose();
    const PostModel = mongoose.model(BlogPost.name, BlogPostSchema);

    const error = (await new PostModel({ moderation: 'deleted' })
      .validate()
      .catch((caught: unknown) => caught)) as {
      errors?: Record<string, unknown>;
    };
    expect(error.errors?.moderation).toBeDefined();
  });
});
