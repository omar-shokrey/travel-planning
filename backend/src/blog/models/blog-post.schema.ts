import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';

@Schema({ collection: 'blog_posts', timestamps: true })
export class BlogPost {
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [String], default: [] })
  images: string[];

  @Prop({ required: true, trim: true })
  status: string;

  @Prop({ default: 0, min: 0 })
  likeCount: number;

  @Prop({ default: 0, min: 0 })
  commentCount: number;

  @Prop({ required: true, trim: true })
  moderation: string;

  @Prop({ default: false })
  authorDeactivated: boolean;

  @Prop()
  publishedAt?: Date;
}

export type BlogPostDocument = HydratedDocument<BlogPost>;

export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);

BlogPostSchema.index({
  authorId: 1,
  status: 1,
  moderation: 1,
  publishedAt: -1,
  _id: -1,
});
