import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import {
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from '../dto/create-post.dto';
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
