import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';

/** One user's like on one post (BLG-06). */
@Schema({ collection: 'likes', timestamps: true })
export class Like {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'BlogPost', required: true })
  postId: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type LikeDocument = HydratedDocument<Like>;
export const LikeSchema = SchemaFactory.createForClass(Like);

// "Like once": the database refuses a second like by the same user on a post,
// even when two requests arrive at the same moment (BLG-06).
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
