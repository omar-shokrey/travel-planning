import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { UserStatus } from '../common/enums/user-status.enum';
import { User } from '../users/models/user.schema';
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import type {
  MarkAllReadResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import type { NotificationLinkType } from './enums/notification-link-type.enum';
import type { NotificationType } from './enums/notification-type.enum';
import { type EmailRecipient, EmailService } from './email.service';
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
 * write has succeeded. Each notification is also sent by email (GEN-01-B)
 * when SMTP is configured.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    // GEN-01-B: read only, the address and name of each recipient.
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly email: EmailService,
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
   *
   * GEN-01-B: after the insert attempt, the same text is emailed to the same
   * users as a second, independent step: it runs even if the insert failed,
   * its failure never removes the in-app notification, and the caller does
   * not wait for the mail server. Nothing is looked up or sent when email is
   * switched off.
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

    if (this.email.enabled) {
      this.email.runInBackground(
        () => this.emailUsers(uniqueIds, type, message),
        `"${type}" notification`,
      );
    }
  }

  /**
   * GEN-01-B: one query for the address and name of every recipient, then
   * one email each. A deactivated account (ACC-12) gets no email; a
   * suspended one still does, since it is told about its suspension.
   */
  private async emailUsers(
    userIds: string[],
    type: NotificationType,
    message: string,
  ): Promise<void> {
    const recipients = await this.users
      .find({
        _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
        status: { $ne: UserStatus.Deactivated },
      })
      .select('email name')
      .lean<EmailRecipient[]>()
      .exec();
    await this.email.sendNotification(recipients, type, message);
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
