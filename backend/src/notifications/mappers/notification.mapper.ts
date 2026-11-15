import type { Types } from 'mongoose';
import type { NotificationResponseDto } from '../dto/notification-response.dto';
import type { Notification } from '../models/notification.schema';

/** The fields the mapper reads. A notification document and a lean one both fit. */
export type NotificationSource = Pick<
  Notification,
  'type' | 'message' | 'linkType' | 'linkId' | 'readAt' | 'createdAt'
> & { _id: Types.ObjectId };

/** Turns a stored notification into what the API returns. The owner id stays private. */
export function toNotificationResponse(
  notification: NotificationSource,
): NotificationResponseDto {
  const readAt = notification.readAt ?? null;
  return {
    id: notification._id.toString(),
    type: notification.type,
    message: notification.message,
    linkType: notification.linkType ?? null,
    linkId: notification.linkId?.toString() ?? null,
    read: readAt !== null,
    readAt: readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}
