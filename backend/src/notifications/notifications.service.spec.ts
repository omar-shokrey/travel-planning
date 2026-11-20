import { Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import { plainToInstance } from 'class-transformer';
import { Types, type Model } from 'mongoose';
import { UserStatus } from '../common/enums/user-status.enum';
import type { User } from '../users/models/user.schema';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { EmailService } from './email.service';
import { NotificationLinkType } from './enums/notification-link-type.enum';
import { NotificationType } from './enums/notification-type.enum';
import type { MailTransport, OutgoingMail } from './mail-transport';
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

const config = {
  get: (name: string) =>
    ({
      FRONTEND_URL: 'http://localhost:3000',
      MAIL_FROM: 'Travel Platform <no-reply@example.com>',
    })[name],
} as unknown as ConfigService<EnvironmentVariables, true>;

/**
 * The service with a fake notifications model, a fake users model whose
 * `find` answers `recipients`, and a real EmailService on `transport` (null:
 * email switched off).
 */
function setup(
  transport: MailTransport | null = null,
  recipients: unknown[] = [],
) {
  const select = jest.fn().mockReturnThis();
  const users = {
    find: jest.fn((..._args: unknown[]) => ({
      select,
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(recipients),
    })),
  };
  const email = new EmailService(transport, config);
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
    users as unknown as Model<User>,
    email,
  );
  return { model, service, users, select, email };
}

/** A transport that records every email. */
function fakeTransport() {
  const sent: OutgoingMail[] = [];
  const sendMail = jest.fn((mail: OutgoingMail) => {
    sent.push(mail);
    return Promise.resolve({});
  });
  return { sent, sendMail };
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

  describe('email (GEN-01-B)', () => {
    let error: jest.SpyInstance;
    let warn: jest.SpyInstance;
    beforeEach(() => {
      error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => {
      error.mockRestore();
      warn.mockRestore();
    });

    const people = [
      { _id: new Types.ObjectId(USER_ID), email: 'a@example.com', name: 'Ann' },
      {
        _id: new Types.ObjectId(OTHER_USER_ID),
        email: 'b@example.com',
        name: 'Ben',
      },
    ];

    it('still stores the in-app notification, and emails each looked-up user once', async () => {
      const { sent, sendMail } = fakeTransport();
      const { model, service, email } = setup({ sendMail }, people);

      await service.notifyMany(
        [USER_ID, OTHER_USER_ID, USER_ID],
        NotificationType.FlightChanged,
        'Flight MS777 now leaves at 10:00.',
      );
      await email.whenIdle();

      expect(model.insertMany).toHaveBeenCalledTimes(1);
      expect(sent.map((mail) => mail.to)).toEqual([
        'a@example.com',
        'b@example.com',
      ]);
      expect(sent[0]).toMatchObject({
        subject: 'Your flight has changed',
        text: expect.stringContaining(
          'Flight MS777 now leaves at 10:00.',
        ) as string,
      });
    });

    it('looks the recipients up with ONE query: their ids, not deactivated, address and name only', async () => {
      const { sendMail } = fakeTransport();
      const { service, users, select, email } = setup({ sendMail }, people);

      await service.notifyMany(
        [USER_ID, OTHER_USER_ID],
        NotificationType.Refund,
        'Refund.',
      );
      await email.whenIdle();

      expect(users.find).toHaveBeenCalledTimes(1);
      expect(users.find).toHaveBeenCalledWith({
        _id: {
          $in: [new Types.ObjectId(USER_ID), new Types.ObjectId(OTHER_USER_ID)],
        },
        status: { $ne: UserStatus.Deactivated },
      });
      expect(select).toHaveBeenCalledWith('email name');
    });

    it('skips a deactivated account (ACC-12): the query leaves it out, so it gets no email', async () => {
      const { sent, sendMail } = fakeTransport();
      // The deactivated user is not among the accounts the query returns.
      const { service, email } = setup({ sendMail }, [people[0]]);

      await service.notifyMany(
        [USER_ID, OTHER_USER_ID],
        NotificationType.Refund,
        'Refund.',
      );
      await email.whenIdle();

      expect(sent.map((mail) => mail.to)).toEqual(['a@example.com']);
    });

    it('still emails a suspended account, which is told about its suspension', async () => {
      const { sent, sendMail } = fakeTransport();
      const { service, users, email } = setup({ sendMail }, [people[0]]);

      await service.notify(
        USER_ID,
        NotificationType.AccountSuspended,
        'Your account is suspended.',
      );
      await email.whenIdle();

      const filter = users.find.mock.calls[0][0] as { status: unknown };
      expect(filter.status).toEqual({ $ne: UserStatus.Deactivated });
      expect(filter.status).not.toEqual({ $ne: UserStatus.Suspended });
      expect(sent).toHaveLength(1);
    });

    it('never throws when the email fails, and the in-app notification stays', async () => {
      const sendMail = jest.fn().mockRejectedValue(new Error('down'));
      const { model, service, email } = setup({ sendMail }, people);

      await expect(
        service.notify(USER_ID, NotificationType.Refund, 'Refund.'),
      ).resolves.toBeUndefined();
      await email.whenIdle();

      expect(model.insertMany).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('never throws when the user lookup fails, and logs it', async () => {
      const { sendMail } = fakeTransport();
      const { service, users, email } = setup({ sendMail }, people);
      users.find.mockImplementationOnce(() => {
        throw new Error('db down');
      });

      await expect(
        service.notify(USER_ID, NotificationType.Refund, 'Refund.'),
      ).resolves.toBeUndefined();
      await email.whenIdle();

      expect(sendMail).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        'Could not email the "refund" notification (unknown error)',
      );
    });

    it('still tries the email when the in-app insert fails', async () => {
      const { sent, sendMail } = fakeTransport();
      const { model, service, email } = setup({ sendMail }, people);
      model.insertMany.mockRejectedValueOnce(new Error('insert failed'));

      await service.notify(USER_ID, NotificationType.Refund, 'Refund.');
      await email.whenIdle();

      expect(sent).toHaveLength(2);
      expect(error).toHaveBeenCalledWith(
        'Could not send a "refund" notification to 1 user(s)',
        expect.any(String),
      );
    });

    it('does not make the caller wait for the mail server', async () => {
      let release: () => void = () => undefined;
      const sendMail = jest.fn(
        () => new Promise<void>((resolve) => (release = resolve)),
      );
      const { service, email } = setup({ sendMail }, [people[0]]);

      await service.notify(USER_ID, NotificationType.Refund, 'Refund.');

      // notify has returned while the email is still being sent.
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendMail).toHaveBeenCalledTimes(1);
      release();
      await email.whenIdle();
    });

    it('looks nobody up and sends nothing when email is switched off', async () => {
      const { model, service, users } = setup(null, people);

      await service.notify(USER_ID, NotificationType.Refund, 'Refund.');

      expect(model.insertMany).toHaveBeenCalledTimes(1);
      expect(users.find).not.toHaveBeenCalled();
    });

    it('sends no email for an empty list', async () => {
      const { sendMail } = fakeTransport();
      const { service, users, email } = setup({ sendMail }, people);

      await service.notifyMany([], NotificationType.Refund, 'Refund.');
      await email.whenIdle();

      expect(users.find).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});
