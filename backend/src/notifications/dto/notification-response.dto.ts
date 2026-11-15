import { ApiProperty } from '@nestjs/swagger';
import { NotificationLinkType } from '../enums/notification-link-type.enum';
import { NotificationType } from '../enums/notification-type.enum';

/** A notification as the API returns it (GEN-01). */
export class NotificationResponseDto {
  @ApiProperty({ example: '6741a2b3c4d5e6f708192a3b' })
  id: string;

  @ApiProperty({
    enum: NotificationType,
    enumName: 'NotificationType',
    example: NotificationType.BookingConfirmed,
  })
  type: NotificationType;

  @ApiProperty({ example: 'Your flight booking TP-8K2Q4M is confirmed.' })
  message: string;

  @ApiProperty({
    enum: NotificationLinkType,
    enumName: 'NotificationLinkType',
    nullable: true,
    description: 'The kind of record the notification points to, if any',
    example: NotificationLinkType.FlightBooking,
  })
  linkType: NotificationLinkType | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The id of the record the notification points to, if any',
    example: '6741a2b3c4d5e6f708192a3c',
  })
  linkId: string | null;

  @ApiProperty({ description: 'True once the user has read it' })
  read: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the user read it, in UTC. Null while unread.',
    example: null,
  })
  readAt: string | null;

  @ApiProperty({
    description: 'When it was sent, in UTC',
    example: '2026-11-14T09:30:00.000Z',
  })
  createdAt: string;
}

/** The number on the notification bell (GEN-01). */
export class UnreadCountResponseDto {
  @ApiProperty({ description: 'Unread notifications of the user', example: 3 })
  count: number;
}

/** The answer of "mark all as read". */
export class MarkAllReadResponseDto {
  @ApiProperty({
    description: 'How many notifications were unread and are now read',
    example: 3,
  })
  updated: number;
}
