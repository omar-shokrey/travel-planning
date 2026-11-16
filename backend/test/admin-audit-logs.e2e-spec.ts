import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { AuditLog } from './../src/audit/models/audit-log.schema';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteAuditLogsOf } from './support/delete-audit-logs';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const TEMPORARY_PASSWORD = 'Temp0rary1';
const ROUTE = '/api/admin/audit-logs';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (label: string): string =>
  `gen07-${label}-${randomUUID()}@example.com`;

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

interface AuditItem {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string | null;
  createdAt: string;
}

describe('GET /api/admin/audit-logs and the recorded admin actions (e2e, GEN-07)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let auditLogs: Model<AuditLog>;
  /** Every account these tests made: inserted ones and created moderators. */
  const createdUserIds: string[] = [];
  /** The id of each inserted account, by label. */
  const ids = new Map<string, string>();
  const cookies = new Map<string, string>();
  let hotelId = '';

  const list = (query: Record<string, string> = {}, who: string | null) => {
    const call = request(app.getHttpServer()).get(ROUTE).query(query);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  const reset = (who: string, targetId: string) =>
    request(app.getHttpServer())
      .post(`/api/admin/users/${targetId}/reset-password`)
      .set('Cookie', cookies.get(who) ?? '')
      .send({ temporaryPassword: TEMPORARY_PASSWORD });

  const id = (label: string): string => ids.get(label) ?? '';

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
    auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database (ACC-14, BLG-01).
    const [hotel] = await hotels.insertMany([
      {
        name: 'GEN-07 Test Hotel',
        addressLine: '1 Test Street',
        cityId: `gen07-city-${randomUUID()}`,
        countryCode: 'XX',
        description: 'Made by the GEN-07 e2e test.',
        starClass: 3,
        amenities: [],
        photos: [],
      },
    ]);
    hotelId = hotel._id.toString();

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role][] = [
      ['admin', Role.Admin],
      ['second-admin', Role.Admin],
      ['other-admin', Role.Admin],
      ['user', Role.User],
      ['target', Role.User],
      ['second-target', Role.User],
    ];
    const inserted = await users.insertMany(
      accounts.map(([label, role]) => ({
        name: `GEN-07 ${label}`,
        email: uniqueEmail(label),
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
      })),
    );
    for (const [index, user] of inserted.entries()) {
      const [label] = accounts[index];
      createdUserIds.push(user._id.toString());
      ids.set(label, user._id.toString());
    }
    for (const label of ['admin', 'second-admin', 'other-admin', 'user']) {
      const index = accounts.findIndex(([name]) => name === label);
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: inserted[index].email, password: PASSWORD });
      expect(response.status).toBe(200);
      cookies.set(
        label,
        `${ACCESS_TOKEN_COOKIE}=${cookieValue(response, ACCESS_TOKEN_COOKIE)}`,
      );
    }
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await deleteSessionsOf(app, userId);
    }
    // The records the actions of these tests wrote, one by one by id.
    await deleteAuditLogsOf(app, createdUserIds);
    for (const userId of createdUserIds) {
      await users.findByIdAndDelete(userId);
    }
    await hotels.findByIdAndDelete(hotelId);
    await app.close();
  });

  describe('recorded actions', () => {
    it('a password reset (ACC-07a) writes one record with the admin, the action and the account', async () => {
      await reset('admin', id('target')).expect(200);

      const stored = await auditLogs
        .find({ targetId: id('target') })
        .lean()
        .exec();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        action: 'reset_password',
        targetType: 'user',
        targetId: id('target'),
      });
      expect(stored[0].adminId.toString()).toBe(id('admin'));
      expect(JSON.stringify(stored[0])).not.toContain(TEMPORARY_PASSWORD);

      const response = await list({ targetId: id('target') }, 'admin');
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([
        {
          id: stored[0]._id.toString(),
          adminId: id('admin'),
          action: 'reset_password',
          targetType: 'user',
          targetId: id('target'),
          details: null,
          createdAt: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
          ),
        },
      ]);
    });

    it('a moderator creation (ACC-13) writes one record with the admin, the action and the new account', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/moderators')
        .set('Cookie', cookies.get('admin') ?? '')
        .send({
          name: 'GEN-07 Moderator',
          email: uniqueEmail('moderator'),
          role: Role.HotelModerator,
          providerId: hotelId,
          temporaryPassword: TEMPORARY_PASSWORD,
        });
      expect(created.status).toBe(201);
      const moderatorId = created.body.id as string;
      createdUserIds.push(moderatorId);

      const response = await list({ targetId: moderatorId }, 'admin');

      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(1);
      const [item] = response.body.items as AuditItem[];
      expect(item).toMatchObject({
        adminId: id('admin'),
        action: 'create_moderator',
        targetType: 'user',
        targetId: moderatorId,
        details: `hotel_moderator of hotel ${hotelId}`,
      });
      expect(JSON.stringify(response.body)).not.toContain(TEMPORARY_PASSWORD);
    });

    it('a refused action records nothing', async () => {
      await reset('admin', id('other-admin')).expect(403);

      const response = await list({ targetId: id('other-admin') }, 'admin');

      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('the list', () => {
    it('is newest first and paginated (GEN-05)', async () => {
      await reset('second-admin', id('target')).expect(200);
      await reset('second-admin', id('second-target')).expect(200);

      const first = await list(
        { adminId: id('second-admin'), limit: '1' },
        'admin',
      );
      const second = await list(
        { adminId: id('second-admin'), limit: '1', page: '2' },
        'admin',
      );

      expect(first.status).toBe(200);
      expect(first.body.meta).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect((first.body.items as AuditItem[])[0].targetId).toBe(
        id('second-target'),
      );
      expect(second.body.meta.page).toBe(2);
      expect((second.body.items as AuditItem[])[0].targetId).toBe(id('target'));
      const [newer] = first.body.items as AuditItem[];
      const [older] = second.body.items as AuditItem[];
      expect(newer.createdAt >= older.createdAt).toBe(true);
    });

    it('applies every given filter together', async () => {
      const resets = await list(
        { adminId: id('admin'), action: 'reset_password' },
        'admin',
      );
      const creations = await list(
        { adminId: id('admin'), action: 'create_moderator' },
        'admin',
      );
      const onTarget = await list(
        {
          adminId: id('second-admin'),
          targetType: 'user',
          targetId: id('target'),
        },
        'admin',
      );
      const onHotels = await list(
        { adminId: id('admin'), targetType: 'hotel' },
        'admin',
      );

      const actions = (body: { items: AuditItem[] }) =>
        body.items.map((item) => item.action);
      expect(actions(resets.body)).toEqual(['reset_password']);
      expect(actions(creations.body)).toEqual(['create_moderator']);
      expect(onTarget.body.meta.total).toBe(1);
      expect((onTarget.body.items as AuditItem[])[0]).toMatchObject({
        adminId: id('second-admin'),
        targetId: id('target'),
      });
      expect(onHotels.body.items).toEqual([]);
    });

    it.each([
      ['action', 'drop_database'],
      ['targetType', 'airport'],
      ['adminId', 'not-an-id'],
      ['targetId', '123'],
      ['limit', '51'],
      ['page', '0'],
      ['details', 'x'],
    ])('answers 400 for an invalid %s', async (field, value) => {
      const response = await list({ [field]: value }, 'admin');

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field }),
      ]);
    });
  });

  describe('access', () => {
    it('is closed to a registered user (403)', async () => {
      expect((await list({}, 'user')).status).toBe(403);
    });

    it('needs a login (401)', async () => {
      const response = await list({}, null);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('has no route that changes or deletes a record (append-only)', async () => {
      const [record] = await auditLogs
        .find({ targetId: id('target') })
        .select('_id')
        .lean()
        .exec();
      const path = `${ROUTE}/${record._id.toString()}`;
      const cookie = cookies.get('admin') ?? '';

      const deleted = await request(app.getHttpServer())
        .delete(path)
        .set('Cookie', cookie);
      const patched = await request(app.getHttpServer())
        .patch(path)
        .set('Cookie', cookie)
        .send({ details: 'changed' });

      expect(deleted.status).toBe(404);
      expect(patched.status).toBe(404);
      expect(await auditLogs.findById(record._id).lean().exec()).toBeTruthy();
    });
  });

  describe('Swagger', () => {
    it('documents the route, its filters and its answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route = response.body.paths['/api/admin/audit-logs'].get;
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
      const parameters = (route.parameters as { name: string }[]).map(
        (parameter) => parameter.name,
      );
      expect(parameters).toEqual(
        expect.arrayContaining([
          'page',
          'limit',
          'action',
          'adminId',
          'targetType',
          'targetId',
        ]),
      );
    });
  });
});
