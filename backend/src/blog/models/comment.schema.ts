import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { COMMENT_BODY_MAX } from '../blog.constants';

/** A comment a registered user wrote on a published post (BLG-05). */
@Schema({ collection: 'comments', timestamps: true })
export class Comment {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'BlogPost', required: true })
  postId: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: COMMENT_BODY_MAX })
  body: string;

  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);

// The comments of one post are always read oldest first (BLG-05).
CommentSchema.index({ postId: 1, createdAt: 1 });
