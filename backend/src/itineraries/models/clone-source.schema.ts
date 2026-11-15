import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type Types } from 'mongoose';

/**
 * ITN-21: where a cloned itinerary came from. The author's name is copied at
 * clone time, so the credit survives when the original is deleted (ITN-01).
 */
@Schema({ _id: false })
export class CloneSource {
  /** Not enforced: the original may have been deleted. */
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  itineraryId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true })
  authorName: string;
}

export const CloneSourceSchema = SchemaFactory.createForClass(CloneSource);
