import { Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Types, type Model } from 'mongoose';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationLinkType } from './enums/notification-link-type.enum';
import { NotificationType } from './enums/notification-type.enum';
import type { Notification } from './models/notification.schema';
import { NOTIFICATION_NOT_FOUND_MESSAGE } from './notifications.constants';
import { NotificationsService } from './notifications.service';

const USER_ID = '6741a2b3c4d5e6f708192a01';
const OTHER_USER_ID = '6741a2b3c4d5e6f708192a02';
const NOTIFICATION_ID = '6741a2b3c4d5e6f708192a3b';
const BOOKING_ID = '6741a2b3c4d5e6f708192a3c';

/** A stored notification, as a lean query returns it. */
const stored = (fields: Partial<Record<string, unknown>> = {}) => ({
  _id: new Types.ObjectId(NOTIFICATION_ID),
  userId: new Types.ObjectId(USER_ID),
  type: NotificationType.BookingConfirmed,
  message: 'Your booking is confirmed.',
  readAt: null,
  createdAt: new Date('2026-11-14T09:30:00.000Z'),
  ...fields,
});

/** A Mongoose query chain, as far as the service uses it. */
interface QueryChain {
  sort: jest.Mock<QueryChain>;
  skip: jest.Mock<QueryChain>;
  limit: jest.Mock<QueryChain>;
  lean: jest.Mock<QueryChain>;
  exec: jest.Mock<Promise<unknown>, []>;
}

/** A query whose `lean()` and `exec()` answer with `value`. */
const query = (value: unknown): QueryChain => {
  const chain: QueryChain = {
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue(value),
  };
  return chain;
};

function setup() {
  const model = {
    insertMany: jest.fn().mockResolvedValue([]),
    find: jest.fn(() => query([])),
    countDocuments: jest.fn(() => query(0)),
    findOneAndUpdate: jest.fn(() => query(null)),
    findOne: jest.fn(() => query(null)),
    updateMany: jest.fn(() => query({ modifiedCount: 0 })),
  };
  const service = new NotificationsService(
    model as unknown as Model<Notification>,
  );
  return { model, service };
}

const listQuery = (fields: Record<string, unknown> = {}) =>
  plainToInstance(ListNotificationsQueryDto, fields);

describe('NotificationsService', () => {
  describe('notify', () => {
    it('stores one unread notification for the user', async () => {
      const { model, service } = setup();

      await service.notify(
        USER_ID,
        NotificationType.Refund,
        'Your refund is on its way.',
      );

      expect(model.insertMany).toHaveBeenCalledWith([
        {
          userId: new Types.ObjectId(USER_ID),
          type: NotificationType.Refund,
          message: 'Your refund is on its way.',
        },
      ]);
    });

    it('stores the link to the record it is about', async () => {
      const { model, service } = setup();

      await service.notify(
        new Types.ObjectId(USER_ID),
        NotificationType.BookingConfirmed,
        'Confirmed.',
        { type: NotificationLinkType.FlightBooking, id: BOOKING_ID },
      );

      expect(model.insertMany).toHaveBeenCalledWith([
        expect.objectContaining({
          linkType: NotificationLinkType.FlightBooking,
          linkId: new Types.ObjectId(BOOKING_ID),
        }),
      ]);
    });

    it('logs a failed write and never throws', async () => {
      const { model, service } = setup();
      model.insertMany.mockRejectedValue(new Error('database down'));
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.notify(USER_ID, NotificationType.Refund, 'Refund sent.'),
      ).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('"refund"'),
        expect.any(String),
      );
      log.mockRestore();
    });

    it('logs an invalid user id and never throws', async () => {
      const { model, service } = setup();
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.notify('not-an-id', NotificationType.Refund, 'Refund sent.'),
      ).resolves.toBeUndefined();
      expect(model.insertMany).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });
  });

  describe('notifyMany', () => {
    it('stores one notification per user, once per user, in one write', async () => {
      const { model, service } = setup();

      await service.notifyMany(
        [USER_ID, OTHER_USER_ID, new Types.ObjectId(USER_ID)],
        NotificationType.FlightChanged,
        'Your flight now leaves at 10:00.',
      );

      expect(model.insertMany).toHaveBeenCalledTimes(1);
      const docs = model.insertMany.mock.calls[0][0] as { userId: unknown }[];
      expect(docs.map((doc) => String(doc.userId))).toEqual([
        USER_ID,
        OTHER_USER_ID,
      ]);
    });

    it('does nothing for an empty list', async () => {
      const { model, service } = setup();

      await service.notifyMany([], NotificationType.FlightChanged, 'Changed.');

      expect(model.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns a page of the caller’s notifications, newest first', async () => {
      const { model, service } = setup();
      const found = query([stored()]);
      model.find.mockReturnValue(found);
      model.countDocuments.mockReturnValue(query(11));

      const page = await service.list(
        USER_ID,
        listQuery({ page: '2', limit: '5' }),
      );

      const filter = { userId: new Types.ObjectId(USER_ID) };
      expect(model.find).toHaveBeenCalledWith(filter);
      expect(model.countDocuments).toHaveBeenCalledWith(filter);
      expect(found.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(found.skip).toHaveBeenCalledWith(5);
      expect(found.limit).toHaveBeenCalledWith(5);
      expect(page.meta).toEqual({
        page: 2,
        limit: 5,
        total: 11,
        totalPages: 3,
      });
      expect(page.items).toEqual([
        expect.objectContaining({ id: NOTIFICATION_ID, read: false }),
      ]);
    });

    it('filters on unread notifications', async () => {
      const { model, service } = setup();

      await service.list(USER_ID, listQuery({ unread: 'true' }));

      expect(model.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(USER_ID),
        readAt: null,
      });
    });

    it('filters on read notifications', async () => {
      const { model, service } = setup();

      await service.list(USER_ID, listQuery({ unread: 'false' }));

      expect(model.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(USER_ID),
        readAt: { $ne: null },
      });
    });

    it('returns an empty page when there is nothing', async () => {
      const { service } = setup();

      expect(await service.list(USER_ID, listQuery())).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('unreadCount', () => {
    it('counts the caller’s unread notifications', async () => {
      const { model, service } = setup();
      model.countDocuments.mockReturnValue(query(3));

      expect(await service.unreadCount(USER_ID)).toEqual({ count: 3 });
      expect(model.countDocuments).toHaveBeenCalledWith({
        userId: new Types.ObjectId(USER_ID),
        readAt: null,
      });
    });
  });

  describe('markRead', () => {
    const owned = {
      _id: new Types.ObjectId(NOTIFICATION_ID),
      userId: new Types.ObjectId(USER_ID),
    };

    it('sets the read time of an unread notification of the caller', async () => {
      const { model, service } = setup();
      const readAt = new Date('2026-11-14T10:00:00.000Z');
      model.findOneAndUpdate.mockReturnValue(query(stored({ readAt })));

      const response = await service.markRead(USER_ID, NOTIFICATION_ID);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { ...owned, readAt: null },
        { $set: { readAt: expect.any(Date) } },
        { returnDocument: 'after' },
      );
      expect(model.findOne).not.toHaveBeenCalled();
      expect(response).toEqual(
        expect.objectContaining({ read: true, readAt: readAt.toISOString() }),
      );
    });

    it('keeps the first read time of a notification already read', async () => {
      const { model, service } = setup();
      const readAt = new Date('2026-11-13T08:00:00.000Z');
      model.findOne.mockReturnValue(query(stored({ readAt })));

      const response = await service.markRead(USER_ID, NOTIFICATION_ID);

      expect(model.findOne).toHaveBeenCalledWith(owned);
      expect(response.readAt).toBe('2026-11-13T08:00:00.000Z');
    });

    it('answers 404 for a notification of someone else or a missing one', async () => {
      const { service } = setup();

      await expect(
        service.markRead(OTHER_USER_ID, NOTIFICATION_ID),
      ).rejects.toThrow(new NotFoundException(NOTIFICATION_NOT_FOUND_MESSAGE));
    });
  });

  describe('markAllRead', () => {
    it('marks only the caller’s unread notifications and returns the count', async () => {
      const { model, service } = setup();
      model.updateMany.mockReturnValue(query({ modifiedCount: 4 }));

      expect(await service.markAllRead(USER_ID)).toEqual({ updated: 4 });
      expect(model.updateMany).toHaveBeenCalledWith(
        { userId: new Types.ObjectId(USER_ID), readAt: null },
        { $set: { readAt: expect.any(Date) } },
      );
    });
  });
});
