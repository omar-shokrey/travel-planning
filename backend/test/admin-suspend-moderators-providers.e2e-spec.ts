import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import {
  ACCOUNT_SUSPENDED_NOTIFICATION,
  PROVIDER_ALREADY_DEACTIVATED_MESSAGE,
  PROVIDER_NOT_DEACTIVATED_MESSAGE,
  PROVIDER_TYPE_MESSAGE,
} from './../src/admin/admin.constants';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Airline } from './../src/flights/models/airline.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { Notification } from './../src/notifications/models/notification.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';

/** The access cookie of a login response, ready for a `Cookie` header. */
function accessCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const lines = Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
  const line = lines.find((candidate) =>
    candidate.startsWith(`${ACCESS_TOKEN_COOKIE}=`),
  );
  return line?.split(';')[0] ?? '';
}

describe('Suspend moderators and deactivate providers (e2e, ACC-15)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let airlines: Model<Airline>;
  let notifications: Model<Notification>;
  const createdUserIds: string[] = [];
  const accounts = new Map<string, { id: string; email: string }>();
  const hotelId = new Types.ObjectId();
  const airlineId = new Types.ObjectId();
  const hotelName = `ACC-15 Hotel ${randomUUID()}`;
  const airlineName = `ACC-15 Airline ${randomUUID()}`;
  let adminCookie = '';

  const server = () => request(app.getHttpServer());
  const idOf = (label: string) => accounts.get(label)?.id ?? '';

  const login = (label: string) =>
    server()
      .post('/api/auth/login')
      .send({ email: accounts.get(label)?.email, password: PASSWORD });

  const startSession = async (label: string): Promise<string> => {
    const response = await login(label);
    expect(response.status).toBe(200);
    return accessCookie(response);
  };

  const suspension = (action: 'suspend' | 'reactivate', label: string) =>
    server()
      .patch(`/api/admin/accounts/${idOf(label)}/${action}`)
      .set('Cookie', adminCookie);

  const providerAction = (
    action: 'deactivate' | 'reactivate',
    type: string,
    id: string,
    cookie: string | null = adminCookie,
  ) => {
    const call = server().patch(`/api/admin/providers/${type}/${id}/${action}`);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const notificationsOf = (label: string) =>
    notifications
      .find({ userId: new Types.ObjectId(idOf(label)) })
      .sort({ createdAt: 1 })
      .lean();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    notifications = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database.
    await hotels.insertMany([
      {
        _id: hotelId,
        name: hotelName,
        addressLine: '1 Test Street',
        cityId: 'acc15-city',
        countryCode: 'EG',
        description: 'A hotel created by the ACC-15 e2e test.',
        starClass: 3,
        active: true,
      },
    ]);
    await airlines.insertMany([
      {
        _id: airlineId,
        name: airlineName,
        code: `Q${randomUUID().slice(0, 6).toUpperCase()}`,
        logo: 'acc15-logo.png',
        active: true,
      },
    ]);

    const passwordHash = await hash(PASSWORD, 4);
    const hotelAssignment = {
      providerType: ProviderType.Hotel,
      providerId: hotelId,
    };
    const seeds: [string, Role, UserStatus, object | undefined][] = [
      ['admin', Role.Admin, UserStatus.Active, undefined],
      ['user', Role.User, UserStatus.Active, undefined],
      [
        'hotelModerator',
        Role.HotelModerator,
        UserStatus.Active,
        hotelAssignment,
      ],
      [
        'secondHotelModerator',
        Role.HotelModerator,
        UserStatus.Active,
        hotelAssignment,
      ],
      [
        'closedHotelModerator',
        Role.HotelModerator,
        UserStatus.Deactivated,
        hotelAssignment,
      ],
      [
        'otherHotelModerator',
        Role.HotelModerator,
        UserStatus.Active,
        { providerType: ProviderType.Hotel, providerId: new Types.ObjectId() },
      ],
      [
        'airlineModerator',
        Role.AirlineModerator,
        UserStatus.Active,
        { providerType: ProviderType.Airline, providerId: airlineId },
      ],
    ];
    const inserted = await users.insertMany(
      seeds.map(([label, role, status, assignment]) => ({
        name: `ACC-15 ${label}`,
        email: `acc15-${label.toLowerCase()}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status,
        consentAcceptedAt: new Date(),
        ...(assignment && { assignment }),
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      accounts.set(seeds[index][0], {
        id: user._id.toString(),
        email: user.email,
      });
    }
    adminCookie = await startSession('admin');
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      const found = await notifications
        .find({ userId: new Types.ObjectId(id) })
        .select('_id')
        .lean();
      for (const { _id } of found) {
        await notifications.findByIdAndDelete(_id);
      }
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await hotels.findByIdAndDelete(hotelId);
    await airlines.findByIdAndDelete(airlineId);
    await app.close();
  });

  describe('suspending a moderator', () => {
    it.each(['secondHotelModerator', 'airlineModerator'])(
      'suspends the %s, ends its sessions, refuses its login and notifies it',
      async (label) => {
        const session = await startSession(label);

        const response = await suspension('suspend', label);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          id: idOf(label),
          status: 'suspended',
        });
        const me = await server().get('/api/auth/me').set('Cookie', session);
        expect(me.status).toBe(401);
        const again = await login(label);
        expect(again.status).toBe(403);
        expect(again.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
        const told = await notificationsOf(label);
        expect(told).toHaveLength(1);
        expect(told[0]).toMatchObject({
          type: 'account_suspended',
          message: ACCOUNT_SUSPENDED_NOTIFICATION,
        });
      },
    );

    it.each(['secondHotelModerator', 'airlineModerator'])(
      'reactivates the %s, who can log in again',
      async (label) => {
        const response = await suspension('reactivate', label);

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('active');
        expect((await login(label)).status).toBe(200);
      },
    );

    it('leaves the provider of a suspended moderator active', async () => {
      expect((await hotels.findById(hotelId).lean())?.active).toBe(true);
      expect((await airlines.findById(airlineId).lean())?.active).toBe(true);
    });
  });

  describe('deactivating and reactivating a hotel', () => {
    let moderatorSession = '';

    it('deactivates the hotel and answers with its status', async () => {
      moderatorSession = await startSession('hotelModerator');

      const response = await providerAction(
        'deactivate',
        'hotel',
        hotelId.toString(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        type: 'hotel',
        id: hotelId.toString(),
        name: hotelName,
        active: false,
      });
      expect((await hotels.findById(hotelId).lean())?.active).toBe(false);
    });

    it('notifies every moderator of the hotel, with a link to it', async () => {
      for (const label of ['hotelModerator', 'secondHotelModerator']) {
        const told = (await notificationsOf(label)).filter(
          (notification) => notification.type === 'provider_deactivated',
        );
        expect(told).toHaveLength(1);
        expect(told[0].message).toContain(hotelName);
        expect(told[0].linkType).toBe('hotel');
        expect(told[0].linkId?.toString()).toBe(hotelId.toString());
      }
    });

    it('notifies no one else', async () => {
      for (const label of [
        'closedHotelModerator',
        'otherHotelModerator',
        'airlineModerator',
        'user',
      ]) {
        const told = (await notificationsOf(label)).filter(
          (notification) => notification.type === 'provider_deactivated',
        );
        expect(told).toHaveLength(0);
      }
    });

    it('does not suspend the moderators of the hotel', async () => {
      expect(
        (await users.findById(idOf('hotelModerator')).lean())?.status,
      ).toBe('active');
      const me = await server()
        .get('/api/auth/me')
        .set('Cookie', moderatorSession);
      expect(me.status).toBe(200);
    });

    it('answers 409 to a second deactivation', async () => {
      const response = await providerAction(
        'deactivate',
        'hotel',
        hotelId.toString(),
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(PROVIDER_ALREADY_DEACTIVATED_MESSAGE);
    });

    it('reactivates the hotel', async () => {
      const response = await providerAction(
        'reactivate',
        'hotel',
        hotelId.toString(),
      );

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(true);
      expect((await hotels.findById(hotelId).lean())?.active).toBe(true);
    });

    it('answers 409 to reactivating an active hotel', async () => {
      const response = await providerAction(
        'reactivate',
        'hotel',
        hotelId.toString(),
      );

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(PROVIDER_NOT_DEACTIVATED_MESSAGE);
    });
  });

  describe('deactivating and reactivating an airline', () => {
    it('deactivates the airline and notifies its moderator without a link', async () => {
      const response = await providerAction(
        'deactivate',
        'airline',
        airlineId.toString(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        type: 'airline',
        id: airlineId.toString(),
        name: airlineName,
        active: false,
      });
      expect((await airlines.findById(airlineId).lean())?.active).toBe(false);
      const told = (await notificationsOf('airlineModerator')).filter(
        (notification) => notification.type === 'provider_deactivated',
      );
      expect(told).toHaveLength(1);
      expect(told[0].message).toContain(airlineName);
      expect(told[0].linkType).toBeUndefined();
      expect(
        (await users.findById(idOf('airlineModerator')).lean())?.status,
      ).toBe('active');
    });

    it('answers 409 to a second deactivation, then reactivates it', async () => {
      const again = await providerAction(
        'deactivate',
        'airline',
        airlineId.toString(),
      );
      expect(again.status).toBe(409);

      const response = await providerAction(
        'reactivate',
        'airline',
        airlineId.toString(),
      );
      expect(response.status).toBe(200);
      expect(response.body.active).toBe(true);
    });
  });

  describe('invalid requests', () => {
    it.each(['hotel', 'airline'])(
      'answers 404 for a %s that does not exist',
      async (type) => {
        const response = await providerAction(
          'deactivate',
          type,
          new Types.ObjectId().toString(),
        );

        expect(response.status).toBe(404);
      },
    );

    it('answers 400 for a type that is not hotel or airline', async () => {
      const response = await providerAction(
        'deactivate',
        'ship',
        hotelId.toString(),
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(PROVIDER_TYPE_MESSAGE);
    });

    it('answers 400 for an id that is not an id', async () => {
      const response = await providerAction('deactivate', 'hotel', 'not-an-id');

      expect(response.status).toBe(400);
    });
  });

  describe('who may do it', () => {
    it.each(['user', 'hotelModerator'])(
      'is closed to a %s, and changes nothing',
      async (label) => {
        const cookie = await startSession(label);

        const response = await providerAction(
          'deactivate',
          'hotel',
          hotelId.toString(),
          cookie,
        );

        expect(response.status).toBe(403);
        expect((await hotels.findById(hotelId).lean())?.active).toBe(true);
      },
    );

    it('needs a login', async () => {
      const response = await providerAction(
        'deactivate',
        'hotel',
        hotelId.toString(),
        null,
      );

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents both provider routes and their answers', async () => {
      const response = await server().get('/api/docs-json').expect(200);

      for (const action of ['deactivate', 'reactivate']) {
        const route =
          response.body.paths[`/api/admin/providers/{type}/{id}/${action}`]
            .patch;
        expect(Object.keys(route.responses)).toEqual(
          expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
        );
        const type = route.parameters.find(
          (parameter: { name: string }) => parameter.name === 'type',
        );
        expect(type.schema.enum).toEqual(['hotel', 'airline']);
      }
    });
  });
});
