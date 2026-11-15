import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { NotificationLinkType } from '../enums/notification-link-type.enum';
import { NotificationType } from '../enums/notification-type.enum';
import { NOTIFICATION_MESSAGE_MAX_LENGTH } from '../notifications.constants';

/** One in-app notification for one user (GEN-01). Unread while `readAt` is empty. */
@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(NotificationType),
  })
  type: NotificationType;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: NOTIFICATION_MESSAGE_MAX_LENGTH,
  })
  message: string;

  @Prop({ type: String, enum: Object.values(NotificationLinkType) })
  linkType?: NotificationLinkType;

  @Prop({ type: SchemaTypes.ObjectId })
  linkId?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  // Written by Mongoose (`timestamps: true`). Declared only for their type.
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
// The list, the unread filter and the unread count all read by user, newest first.
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
