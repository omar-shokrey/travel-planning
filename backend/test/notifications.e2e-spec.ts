import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { NotificationLinkType } from './../src/notifications/enums/notification-link-type.enum';
import { NotificationType } from './../src/notifications/enums/notification-type.enum';
import { Notification } from './../src/notifications/models/notification.schema';
import { NOTIFICATION_NOT_FOUND_MESSAGE } from './../src/notifications/notifications.constants';
import { MAIL_TRANSPORT } from './../src/notifications/email.constants';
import { EmailService } from './../src/notifications/email.service';
import { NotificationsService } from './../src/notifications/notifications.service';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('/api/notifications (e2e, GEN-01)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let notifications: Model<Notification>;
  let service: NotificationsService;
  /** The records these tests created. Each one is deleted by id at the end. */
  const createdUserIds: string[] = [];
  let passwordHash: string;

  interface TestUser {
    id: string;
    cookie: string;
  }

  /** Creates an account, logs it in and returns the cookie a browser would send. */
  const createLoggedInUser = async (): Promise<TestUser> => {
    const email = `gen01-${randomUUID()}@example.com`;
    const user = await users.create({
      name: 'Notification Test',
      email,
      passwordHash,
      role: Role.User,
      status: UserStatus.Active,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdUserIds.push(id);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    expect(response.status).toBe(200);
    const lines = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    const line = lines.find((l) => l.startsWith(`${ACCESS_TOKEN_COOKIE}=`));
    return { id, cookie: line?.split(';')[0] ?? '' };
  };

  /** The ids of a user's notifications, newest first. */
  const notificationIdsOf = async (userId: string): Promise<string[]> => {
    const docs = await notifications
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec();
    return docs.map((doc) => doc._id.toString());
  };

  const get = (path: string, cookie?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const patch = (path: string, cookie?: string) => {
    const call = request(app.getHttpServer()).patch(path);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD, 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    notifications = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    service = app.get(NotificationsService);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      for (const id of await notificationIdsOf(userId)) {
        await notifications.findByIdAndDelete(id);
      }
      await users.findByIdAndDelete(userId);
    }
    await app.close();
  });

  it('has email switched off with no SMTP host: notify still stores the notification and sends nothing (GEN-01-B)', async () => {
    const user = await createLoggedInUser();

    expect(app.get(MAIL_TRANSPORT)).toBeNull();
    expect(app.get(EmailService).enabled).toBe(false);
    await service.notify(
      user.id,
      NotificationType.Refund,
      'Refund on its way.',
    );
    await app.get(EmailService).whenIdle();

    expect(await notificationIdsOf(user.id)).toHaveLength(1);
  });

  it('answers 401 to every route when nobody is logged in', async () => {
    const id = new Types.ObjectId().toString();

    expect((await get('/api/notifications')).status).toBe(401);
    expect((await get('/api/notifications/unread-count')).status).toBe(401);
    expect((await patch('/api/notifications/read-all')).status).toBe(401);
    expect((await patch(`/api/notifications/${id}/read`)).status).toBe(401);
  });

  it('lists a new user with no notifications as an empty page', async () => {
    const user = await createLoggedInUser();

    const response = await get('/api/notifications', user.cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('shows what notify() sent, newest first, with the unread count', async () => {
    const user = await createLoggedInUser();
    const bookingId = new Types.ObjectId().toString();
    await service.notify(
      user.id,
      NotificationType.BookingConfirmed,
      'Your booking is confirmed.',
      { type: NotificationLinkType.FlightBooking, id: bookingId },
    );
    await service.notify(user.id, NotificationType.Refund, 'Refund sent.');

    const list = await get('/api/notifications', user.cookie);
    const count = await get('/api/notifications/unread-count', user.cookie);

    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(2);
    expect(list.body.items[0]).toEqual({
      id: expect.any(String),
      type: 'refund',
      message: 'Refund sent.',
      linkType: null,
      linkId: null,
      read: false,
      readAt: null,
      createdAt: expect.stringMatching(ISO_UTC),
    });
    expect(list.body.items[1]).toEqual(
      expect.objectContaining({
        type: 'booking_confirmed',
        linkType: 'flight_booking',
        linkId: bookingId,
      }),
    );
    expect(JSON.stringify(list.body)).not.toContain(user.id);
    expect(count.status).toBe(200);
    expect(count.body).toEqual({ count: 2 });
  });

  it('marks one notification as read and keeps the first read time', async () => {
    const user = await createLoggedInUser();
    await service.notify(user.id, NotificationType.Refund, 'Refund sent.');
    const [id] = await notificationIdsOf(user.id);

    const first = await patch(`/api/notifications/${id}/read`, user.cookie);
    const again = await patch(`/api/notifications/${id}/read`, user.cookie);
    const count = await get('/api/notifications/unread-count', user.cookie);

    expect(first.status).toBe(200);
    expect(first.body).toEqual(
      expect.objectContaining({
        id,
        read: true,
        readAt: expect.stringMatching(ISO_UTC),
      }),
    );
    expect(again.status).toBe(200);
    expect(again.body.readAt).toBe(first.body.readAt);
    expect(count.body).toEqual({ count: 0 });
  });

  it('filters the list on unread and read', async () => {
    const user = await createLoggedInUser();
    await service.notify(user.id, NotificationType.Refund, 'One.');
    await service.notify(user.id, NotificationType.Refund, 'Two.');
    const [newest] = await notificationIdsOf(user.id);
    await patch(`/api/notifications/${newest}/read`, user.cookie);

    const unread = await get('/api/notifications?unread=true', user.cookie);
    const read = await get('/api/notifications?unread=false', user.cookie);

    expect(
      unread.body.items.map((n: { message: string }) => n.message),
    ).toEqual(['One.']);
    expect(read.body.items.map((n: { message: string }) => n.message)).toEqual([
      'Two.',
    ]);
  });

  it('marks all of the caller’s notifications as read, and nobody else’s', async () => {
    const user = await createLoggedInUser();
    const other = await createLoggedInUser();
    await service.notifyMany(
      [user.id, other.id],
      NotificationType.FlightChanged,
      'Your flight now leaves at 10:00.',
    );
    await service.notify(user.id, NotificationType.Refund, 'Refund sent.');

    const response = await patch('/api/notifications/read-all', user.cookie);
    const mine = await get('/api/notifications/unread-count', user.cookie);
    const theirs = await get('/api/notifications/unread-count', other.cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 2 });
    expect(mine.body).toEqual({ count: 0 });
    expect(theirs.body).toEqual({ count: 1 });
  });

  it('answers 404 for someone else’s notification and leaves it unread', async () => {
    const owner = await createLoggedInUser();
    const intruder = await createLoggedInUser();
    await service.notify(owner.id, NotificationType.Refund, 'Refund sent.');
    const [id] = await notificationIdsOf(owner.id);

    const response = await patch(
      `/api/notifications/${id}/read`,
      intruder.cookie,
    );
    const ownerCount = await get(
      '/api/notifications/unread-count',
      owner.cookie,
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(NOTIFICATION_NOT_FOUND_MESSAGE);
    expect(ownerCount.body).toEqual({ count: 1 });
  });

  it('answers 404 for a notification that does not exist', async () => {
    const user = await createLoggedInUser();
    const id = new Types.ObjectId().toString();

    const response = await patch(`/api/notifications/${id}/read`, user.cookie);

    expect(response.status).toBe(404);
  });

  it('answers 400 for an id that is not an id', async () => {
    const user = await createLoggedInUser();

    const response = await patch('/api/notifications/abc/read', user.cookie);

    expect(response.status).toBe(400);
  });

  it('answers 400 with field errors for an invalid query', async () => {
    const user = await createLoggedInUser();

    const response = await get(
      '/api/notifications?unread=maybe&limit=500&userId=x',
      user.cookie,
    );

    expect(response.status).toBe(400);
    const fields = (response.body.errors as { field: string }[])
      .map((error) => error.field)
      .sort();
    expect(fields).toEqual(['limit', 'unread', 'userId']);
  });
});
