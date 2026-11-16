import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import {
  ACCOUNT_ALREADY_SUSPENDED_MESSAGE,
  ACCOUNT_DEACTIVATED_MESSAGE,
  ACCOUNT_NOT_SUSPENDED_MESSAGE,
  ONLY_USER_STATUS_MESSAGE,
} from './../src/admin/admin.constants';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './../src/auth/auth.constants';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';

/** The value of one cookie in the `Set-Cookie` lines of a response, or undefined. */
function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const header = response.headers['set-cookie'];
  const lines = Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
  const line = lines.find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

interface Session {
  access: string;
  refresh: string;
}

describe('Suspend and reactivate users (e2e, ACC-16)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  const createdUserIds: string[] = [];
  /** The accounts below, by label: their id and email. */
  const accounts = new Map<string, { id: string; email: string }>();
  let adminCookie = '';

  const server = () => request(app.getHttpServer());

  const login = (label: string) =>
    server()
      .post('/api/auth/login')
      .send({ email: accounts.get(label)?.email, password: PASSWORD });

  const startSession = async (label: string): Promise<Session> => {
    const response = await login(label);
    expect(response.status).toBe(200);
    return {
      access: `${ACCESS_TOKEN_COOKIE}=${cookieValue(response, ACCESS_TOKEN_COOKIE)}`,
      refresh: `${REFRESH_TOKEN_COOKIE}=${cookieValue(response, REFRESH_TOKEN_COOKIE)}`,
    };
  };

  const act = (
    action: 'suspend' | 'reactivate',
    id: string,
    cookie: string | null = adminCookie,
  ) => {
    const call = server().patch(`/api/admin/accounts/${id}/${action}`);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  const idOf = (label: string) => accounts.get(label)?.id ?? '';

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));

    // One insertMany: single creates in a row have stalled against the Atlas
    // test database (ACC-14, BLG-01).
    const passwordHash = await hash(PASSWORD, 4);
    const seeds: [string, Role, UserStatus][] = [
      ['admin', Role.Admin, UserStatus.Active],
      ['otherAdmin', Role.Admin, UserStatus.Active],
      ['target', Role.User, UserStatus.Active],
      ['caller', Role.User, UserStatus.Active],
      ['moderator', Role.HotelModerator, UserStatus.Active],
      ['deactivated', Role.User, UserStatus.Deactivated],
    ];
    const inserted = await users.insertMany(
      seeds.map(([label, role, status]) => ({
        name: `ACC-16 ${label}`,
        email: `acc16-${label}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status,
        consentAcceptedAt: new Date(),
        ...(role === Role.HotelModerator && {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: new Types.ObjectId(),
          },
        }),
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      accounts.set(seeds[index][0], {
        id: user._id.toString(),
        email: user.email,
      });
    }
    adminCookie = (await startSession('admin')).access;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('suspending and reactivating a user', () => {
    let before: Session;

    it('suspends the user and ends its sessions at once', async () => {
      before = await startSession('target');

      const response = await act('suspend', idOf('target'));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: idOf('target'),
        role: 'user',
        status: 'suspended',
      });
      // The session is gone, so the old access cookie is not accepted.
      const me = await server()
        .get('/api/auth/me')
        .set('Cookie', before.access);
      expect(me.status).toBe(401);
    });

    it('refuses the suspended user a login and a refresh', async () => {
      const again = await login('target');
      expect(again.status).toBe(403);
      expect(again.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);

      const refresh = await server()
        .post('/api/auth/refresh')
        .set('Cookie', before.refresh);
      expect(refresh.status).toBe(403);
    });

    it('answers 409 to a second suspension', async () => {
      const response = await act('suspend', idOf('target'));

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(ACCOUNT_ALREADY_SUSPENDED_MESSAGE);
    });

    it('reactivates the user, who can log in again; old sessions stay ended', async () => {
      const response = await act('reactivate', idOf('target'));

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('active');
      expect((await login('target')).status).toBe(200);
      const oldRefresh = await server()
        .post('/api/auth/refresh')
        .set('Cookie', before.refresh);
      expect(oldRefresh.status).toBe(401);
    });

    it('answers 409 to reactivating a user that is not suspended', async () => {
      const response = await act('reactivate', idOf('target'));

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(ACCOUNT_NOT_SUSPENDED_MESSAGE);
    });
  });

  describe('accounts that are not changed here', () => {
    it.each(['suspend', 'reactivate'] as const)(
      'answers 400 to %s a moderator (ACC-15), and keeps it active',
      async (action) => {
        const response = await act(action, idOf('moderator'));

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(ONLY_USER_STATUS_MESSAGE);
        expect((await users.findById(idOf('moderator')).lean())?.status).toBe(
          'active',
        );
      },
    );

    it('answers 403 to suspending another administrator', async () => {
      const response = await act('suspend', idOf('otherAdmin'));

      expect(response.status).toBe(403);
      expect((await users.findById(idOf('otherAdmin')).lean())?.status).toBe(
        'active',
      );
    });

    it.each(['suspend', 'reactivate'] as const)(
      'answers 409 to %s a deactivated account (ACC-12)',
      async (action) => {
        const response = await act(action, idOf('deactivated'));

        expect(response.status).toBe(409);
        expect(response.body.message).toBe(ACCOUNT_DEACTIVATED_MESSAGE);
      },
    );

    it('answers 404 for an account that does not exist', async () => {
      const response = await act('suspend', new Types.ObjectId().toString());

      expect(response.status).toBe(404);
    });

    it('answers 400 for an id that is not an id', async () => {
      expect((await act('suspend', 'not-an-id')).status).toBe(400);
    });
  });

  describe('who may do it', () => {
    it('is closed to a registered user, and changes nothing', async () => {
      const caller = await startSession('caller');

      const response = await act('suspend', idOf('target'), caller.access);

      expect(response.status).toBe(403);
      expect((await users.findById(idOf('target')).lean())?.status).toBe(
        'active',
      );
    });

    it('needs a login', async () => {
      const response = await act('suspend', idOf('target'), null);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents both routes and their answers', async () => {
      const response = await server().get('/api/docs-json').expect(200);

      for (const action of ['suspend', 'reactivate']) {
        const route =
          response.body.paths[`/api/admin/accounts/{id}/${action}`].patch;
        expect(Object.keys(route.responses)).toEqual(
          expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
        );
      }
    });
  });
});
