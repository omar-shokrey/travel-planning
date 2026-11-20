import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import {
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from '../dto/create-post.dto';
import { PostModeration } from './post-moderation.enum';
import { PostStatus } from './post-status.enum';

@Schema({ collection: 'posts', timestamps: true })
export class BlogPost {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: POST_TITLE_MAX_LENGTH })
  title: string;

  @Prop({ required: true, trim: true, maxlength: POST_BODY_MAX_LENGTH })
  body: string;

  // Required as well as defaulted: an explicit null is refused here too.
  @Prop({
    type: String,
    required: true,
    enum: Object.values(PostStatus),
    default: PostStatus.Draft,
  })
  status: PostStatus;

  /**
   * GEN-10: set by an admin, never by the author. A hidden post is visible
   * only to its author and to admins. A post stored before this field existed
   * reads as visible (the default applies to hydrated documents).
   */
  @Prop({
    type: String,
    required: true,
    enum: Object.values(PostModeration),
    default: PostModeration.Visible,
  })
  moderation: PostModeration;

  /**
   * ACC-12: set when the author deactivates their own account, never by a
   * request body. It hides the post from everyone (`publishedFilter()` and
   * `visiblePublishedPost`). Every check treats a missing value as false, so
   * a post stored before this field existed stays visible. Not indexed: the
   * public filters already narrow on the indexed fields first.
   */
  @Prop({ type: Boolean, default: false })
  authorDeactivated: boolean;

  @Prop({ type: Date, index: true })
  publishedAt?: Date;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [String], default: [] })
  images: string[];

  /** Kept in step with the `comments` collection by CommentsService (BLG-05). */
  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  /** Kept in step with the `likes` collection by LikesService (BLG-06). */
  @Prop({ type: Number, default: 0, min: 0 })
  likeCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export type BlogPostDocument = HydratedDocument<BlogPost>;
export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);

/** "My posts" (BLG-03): one author's posts, newest first. */
BlogPostSchema.index({ authorId: 1, createdAt: -1, _id: -1 });

/**
 * The tag page (BLG-08): the published, not hidden (GEN-10) posts of one tag,
 * newest first. `status` and `moderation` come before the sort keys, so the
 * filter of `PublishedPostsService.publishedFilter()` uses the index too.
 */
BlogPostSchema.index({
  tags: 1,
  status: 1,
  moderation: 1,
  publishedAt: -1,
  _id: -1,
});

/**
 * The author page (BLG-12): the published, not hidden (GEN-10) posts of one
 * author, newest first. Same order of fields as the tag page index, with the
 * author in place of the tag.
 */
BlogPostSchema.index({
  authorId: 1,
  status: 1,
  moderation: 1,
  publishedAt: -1,
  _id: -1,
});
