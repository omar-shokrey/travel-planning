import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import type {
  MarkAllReadResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import type { NotificationLinkType } from './enums/notification-link-type.enum';
import type { NotificationType } from './enums/notification-type.enum';
import { toNotificationResponse } from './mappers/notification.mapper';
import { Notification } from './models/notification.schema';
import { NOTIFICATION_NOT_FOUND_MESSAGE } from './notifications.constants';

/** The record a notification points to, so the frontend can open it. */
export interface NotificationLink {
  type: NotificationLinkType;
  id: string | Types.ObjectId;
}

/**
 * Owns the `notifications` collection (GEN-01). Other modules import
 * `NotificationsModule` and call `notify` or `notifyMany` after their own
 * write has succeeded.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  /**
   * Sends one in-app notification to one user. It never throws: the booking,
   * refund or suspension that caused it has already been saved, so a failed
   * notification is logged and must not turn that success into an error.
   */
  async notify(
    userId: string | Types.ObjectId,
    type: NotificationType,
    message: string,
    link?: NotificationLink,
  ): Promise<void> {
    await this.notifyMany([userId], type, message, link);
  }

  /**
   * Sends the same notification to several users in one write, for example
   * every passenger of a changed or cancelled flight (FLT-05, FLT-06). A user
   * listed twice is notified once. It never throws, like `notify`.
   */
  async notifyMany(
    userIds: (string | Types.ObjectId)[],
    type: NotificationType,
    message: string,
    link?: NotificationLink,
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds.map((id) => id.toString()))];
    if (uniqueIds.length === 0) {
      return;
    }

    try {
      const linkFields = link
        ? { linkType: link.type, linkId: new Types.ObjectId(link.id) }
        : {};
      await this.notifications.insertMany(
        uniqueIds.map((userId) => ({
          userId: new Types.ObjectId(userId),
          type,
          message,
          ...linkFields,
        })),
      );
    } catch (error) {
      // Only the type and the count are logged: the message can name a
      // booking or a person.
      this.logger.error(
        `Could not send a "${type}" notification to ${uniqueIds.length} user(s)`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** The caller's notifications, newest first, optionally only the unread ones. */
  async list(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedResponse<NotificationResponseDto>> {
    const filter = {
      userId: new Types.ObjectId(userId),
      ...(query.unread === true && { readAt: null }),
      ...(query.unread === false && { readAt: { $ne: null } }),
    };

    const [items, total] = await Promise.all([
      this.notifications
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.notifications.countDocuments(filter).exec(),
    ]);

    return paginate(items.map(toNotificationResponse), total, query);
  }

  /** How many of the caller's notifications are unread. */
  async unreadCount(userId: string): Promise<UnreadCountResponseDto> {
    const count = await this.notifications
      .countDocuments({ userId: new Types.ObjectId(userId), readAt: null })
      .exec();
    return { count };
  }

  /**
   * Marks one of the caller's notifications as read. Marking it again keeps
   * the first read time. Someone else's notification answers 404, like a
   * missing one.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationResponseDto> {
    const owned = {
      _id: new Types.ObjectId(notificationId),
      userId: new Types.ObjectId(userId),
    };

    const updated = await this.notifications
      .findOneAndUpdate(
        { ...owned, readAt: null },
        { $set: { readAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    // Not updated: already read, someone else's, or missing.
    const notification =
      updated ?? (await this.notifications.findOne(owned).lean().exec());
    if (!notification) {
      throw new NotFoundException(NOTIFICATION_NOT_FOUND_MESSAGE);
    }
    return toNotificationResponse(notification);
  }

  /** Marks every unread notification of the caller as read. */
  async markAllRead(userId: string): Promise<MarkAllReadResponseDto> {
    // The filter is one user's unread notifications, never a broad one.
    const result = await this.notifications
      .updateMany(
        { userId: new Types.ObjectId(userId), readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return { updated: result.modifiedCount };
  }
}
