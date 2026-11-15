import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
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

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({
    type: String,
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

  createdAt: Date;
  updatedAt: Date;
}

export type BlogPostDocument = HydratedDocument<BlogPost>;
export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);
