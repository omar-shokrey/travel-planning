import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { FavouriteTargetType } from '../enums/favourite-target-type.enum';

/**
 * BON-02: one hotel or public itinerary a registered user saved. The data
 * model says favourites are a collection of their own. It never leaves the
 * API: the response has no `userId`.
 */
@Schema({ collection: 'favourites', timestamps: true })
export class Favourite {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FavouriteTargetType),
    required: true,
  })
  targetType: FavouriteTargetType;

  /** The hotel's or the itinerary's id. Not a reference: the target may be gone. */
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  targetId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type FavouriteDocument = HydratedDocument<Favourite>;
export const FavouriteSchema = SchemaFactory.createForClass(Favourite);
// One favourite per user and target: a second add finds the first.
FavouriteSchema.index(
  { userId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
// The list of one user, newest first.
FavouriteSchema.index({ userId: 1, createdAt: -1 });
