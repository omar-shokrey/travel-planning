import { Types } from 'mongoose';
import { NotificationLinkType } from '../enums/notification-link-type.enum';
import { NotificationType } from '../enums/notification-type.enum';
import {
  toNotificationResponse,
  type NotificationSource,
} from './notification.mapper';

const source: NotificationSource = {
  _id: new Types.ObjectId('6741a2b3c4d5e6f708192a3b'),
  type: NotificationType.BookingConfirmed,
  message: 'Your flight booking TP-8K2Q4M is confirmed.',
  linkType: NotificationLinkType.FlightBooking,
  linkId: new Types.ObjectId('6741a2b3c4d5e6f708192a3c'),
  readAt: null,
  createdAt: new Date('2026-11-14T11:30:00.000+02:00'),
};

describe('toNotificationResponse', () => {
  it('returns an unread notification with string ids and a UTC date', () => {
    expect(toNotificationResponse(source)).toEqual({
      id: '6741a2b3c4d5e6f708192a3b',
      type: 'booking_confirmed',
      message: 'Your flight booking TP-8K2Q4M is confirmed.',
      linkType: 'flight_booking',
      linkId: '6741a2b3c4d5e6f708192a3c',
      read: false,
      readAt: null,
      createdAt: '2026-11-14T09:30:00.000Z',
    });
  });

  it('marks a notification with a read time as read', () => {
    const response = toNotificationResponse({
      ...source,
      readAt: new Date('2026-11-14T12:00:00.000+02:00'),
    });

    expect(response.read).toBe(true);
    expect(response.readAt).toBe('2026-11-14T10:00:00.000Z');
  });

  it('returns null for a notification with no link', () => {
    const response = toNotificationResponse({
      ...source,
      linkType: undefined,
      linkId: undefined,
    });

    expect(response.linkType).toBeNull();
    expect(response.linkId).toBeNull();
  });

  it('treats a missing read time as unread', () => {
    const { readAt: _readAt, ...withoutReadAt } = source;

    expect(
      toNotificationResponse(withoutReadAt as NotificationSource).read,
    ).toBe(false);
  });

  it('leaves out the owner id and the update time', () => {
    const stored = {
      ...source,
      userId: new Types.ObjectId(),
      updatedAt: new Date(),
    };

    expect(Object.keys(toNotificationResponse(stored)).sort()).toEqual([
      'createdAt',
      'id',
      'linkId',
      'linkType',
      'message',
      'read',
      'readAt',
      'type',
    ]);
  });
});
