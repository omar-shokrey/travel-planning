import { Mongoose, Types } from 'mongoose';
import { NotificationLinkType } from '../enums/notification-link-type.enum';
import { NotificationType } from '../enums/notification-type.enum';
import { NOTIFICATION_MESSAGE_MAX_LENGTH } from '../notifications.constants';
import { Notification, NotificationSchema } from './notification.schema';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const NotificationModel = mongoose.model(Notification.name, NotificationSchema);

const valid = {
  userId: new Types.ObjectId(),
  type: NotificationType.Refund,
  message: 'Your refund of 120.00 USD is on its way.',
};

const invalidFields = (data: Record<string, unknown>): Promise<string[]> =>
  new NotificationModel(data).validate().then(
    () => [],
    (error: { errors: Record<string, unknown> }) =>
      Object.keys(error.errors).sort(),
  );

describe('Notification model', () => {
  it('accepts a notification with a user, a type and a message', async () => {
    expect(await invalidFields(valid)).toEqual([]);
  });

  it('starts unread', () => {
    expect(new NotificationModel(valid).readAt).toBeNull();
  });

  it.each(['userId', 'type', 'message'])('requires %s', async (field) => {
    expect(await invalidFields({ ...valid, [field]: undefined })).toContain(
      field,
    );
  });

  it('rejects a type or a link type that does not exist', async () => {
    expect(await invalidFields({ ...valid, type: 'birthday' })).toEqual([
      'type',
    ]);
    expect(await invalidFields({ ...valid, linkType: 'airport' })).toEqual([
      'linkType',
    ]);
  });

  it('accepts a link to a booking', async () => {
    expect(
      await invalidFields({
        ...valid,
        linkType: NotificationLinkType.HotelBooking,
        linkId: new Types.ObjectId(),
      }),
    ).toEqual([]);
  });

  it('rejects a message longer than the limit', async () => {
    const message = 'a'.repeat(NOTIFICATION_MESSAGE_MAX_LENGTH + 1);

    expect(await invalidFields({ ...valid, message })).toEqual(['message']);
  });

  it('stores the collection as notifications', () => {
    expect(NotificationModel.collection.collectionName).toBe('notifications');
  });

  it('indexes the user, the read time and the creation time', () => {
    expect(NotificationSchema.indexes()).toContainEqual([
      { userId: 1, readAt: 1, createdAt: -1 },
      expect.anything(),
    ]);
  });
});
