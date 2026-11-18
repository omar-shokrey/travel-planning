import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { COMMENT_BODY_MAX } from '../blog.constants';
import { CommentModeration } from './comment-moderation.enum';

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

  /**
   * GEN-10: set by an admin, never by the author (no DTO accepts it). A hidden
   * comment is left out of the comment list and of the post's `commentCount`.
   * A comment stored before this field existed counts as visible.
   */
  @Prop({
    type: String,
    required: true,
    enum: Object.values(CommentModeration),
    default: CommentModeration.Visible,
  })
  moderation: CommentModeration;

  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);

// The comments of one post are always read oldest first (BLG-05).
CommentSchema.index({ postId: 1, createdAt: 1 });
