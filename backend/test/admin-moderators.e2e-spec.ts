import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { compare, hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { PROVIDER_NOT_FOUND_MESSAGE } from './../src/admin/admin.constants';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Airline } from './../src/flights/models/airline.schema';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteAuditLogsOf } from './support/delete-audit-logs';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const TEMPORARY_PASSWORD = 'Temp0rary1';
const ROUTE = '/api/admin/moderators';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (label: string): string =>
  `acc13-${label}-${randomUUID()}@example.com`;

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

describe('POST /api/admin/moderators (e2e, ACC-13)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let airlines: Model<Airline>;
  let hotels: Model<Hotel>;
  const createdUserIds: string[] = [];
  const cookies = new Map<string, string>();
  let airlineId = '';
  let hotelId = '';

  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });

  const accessCookie = (response: { headers: Record<string, unknown> }) =>
    `${ACCESS_TOKEN_COOKIE}=${cookieValue(response, ACCESS_TOKEN_COOKIE)}`;

  const createModerator = (
    body: Record<string, unknown>,
    // null sends no cookie; a default parameter would turn undefined into 'admin'.
    who: string | null = 'admin',
  ) => {
    const call = request(app.getHttpServer()).post(ROUTE).send(body);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  /** Creates a moderator through the route and remembers its id for the clean-up. */
  const created = async (body: Record<string, unknown>) => {
    const response = await createModerator(body);
    if (response.status === 201) {
      createdUserIds.push(response.body.id as string);
    }
    return response;
  };

  const hotelModerator = () => ({
    name: 'Mona Hotel',
    email: uniqueEmail('hotel'),
    role: Role.HotelModerator,
    providerId: hotelId,
    temporaryPassword: TEMPORARY_PASSWORD,
  });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database (ACC-14, BLG-01).
    const [airline] = await airlines.insertMany([
      { name: 'ACC-13 Test Air', code: 'QZ', logo: 'acc13-logo.png' },
    ]);
    airlineId = airline._id.toString();
    const [hotel] = await hotels.insertMany([
      {
        name: 'ACC-13 Test Hotel',
        addressLine: '1 Test Street',
        cityId: `acc13-city-${randomUUID()}`,
        countryCode: 'XX',
        description: 'Made by the ACC-13 e2e test.',
        starClass: 3,
        amenities: [],
        photos: [],
      },
    ]);
    hotelId = hotel._id.toString();

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role][] = [
      ['admin', Role.Admin],
      ['user', Role.User],
    ];
    const inserted = await users.insertMany(
      accounts.map(([label, role]) => ({
        name: `ACC-13 ${label}`,
        email: uniqueEmail(label),
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      const response = await login(user.email, PASSWORD);
      expect(response.status).toBe(200);
      cookies.set(accounts[index][0], accessCookie(response));
    }
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }
    // Each creation wrote an audit record (GEN-07).
    await deleteAuditLogsOf(app, createdUserIds);
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await hotels.findByIdAndDelete(hotelId);
    await airlines.findByIdAndDelete(airlineId);
    await app.close();
  });

  describe('a created moderator', () => {
    it('is an active hotel moderator linked to the hotel, who must change the password', async () => {
      const body = hotelModerator();

      const response = await created(body);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        name: 'Mona Hotel',
        email: body.email,
        role: 'hotel_moderator',
        status: 'active',
        mustChangePassword: true,
        assignment: { providerType: 'hotel', providerId: hotelId },
        createdAt: expect.stringMatching(/Z$/),
      });
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(TEMPORARY_PASSWORD);
      expect(text).not.toContain('passwordHash');
    });

    it('stores only a hash of the temporary password', async () => {
      const response = await created(hotelModerator());

      const stored = await users
        .findById(response.body.id)
        .select('+passwordHash')
        .lean()
        .orFail();
      expect(stored.passwordHash).not.toBe(TEMPORARY_PASSWORD);
      expect(await compare(TEMPORARY_PASSWORD, stored.passwordHash)).toBe(true);
    });

    it('logs in with the temporary password, edits its own hotel, then sets a new password', async () => {
      const body = hotelModerator();
      await created(body);

      const first = await login(body.email, TEMPORARY_PASSWORD);
      expect(first.status).toBe(200);
      expect(first.body.mustChangePassword).toBe(true);
      const cookie = accessCookie(first);

      const edit = await request(app.getHttpServer())
        .patch(`/api/hotels/${hotelId}`)
        .set('Cookie', cookie)
        .send({ description: 'Edited by its new moderator' });
      expect(edit.status).toBe(200);

      const change = await request(app.getHttpServer())
        .patch('/api/auth/change-password')
        .set('Cookie', cookie)
        .send({
          currentPassword: TEMPORARY_PASSWORD,
          newPassword: 'N3wPassword',
        });
      expect(change.status).toBe(200);
      expect(change.body.mustChangePassword).toBe(false);
    });

    it('creates an airline moderator linked to the airline', async () => {
      const response = await created({
        ...hotelModerator(),
        email: uniqueEmail('airline'),
        role: Role.AirlineModerator,
        providerId: airlineId,
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        role: 'airline_moderator',
        assignment: { providerType: 'airline', providerId: airlineId },
      });
    });

    it('lets one hotel have several moderators', async () => {
      const first = await created(hotelModerator());
      const second = await created(hotelModerator());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.assignment).toEqual(first.body.assignment);
    });
  });

  describe('a refused moderator', () => {
    it('refuses a provider that does not exist, and creates no account', async () => {
      const body = {
        ...hotelModerator(),
        providerId: new Types.ObjectId().toString(),
      };

      const response = await createModerator(body);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'providerId', messages: [PROVIDER_NOT_FOUND_MESSAGE.hotel] },
      ]);
      expect(await users.exists({ email: body.email })).toBeNull();
    });

    it.each([
      [
        'a hotel moderator with an airline id',
        Role.HotelModerator,
        'airline',
        'hotel',
      ],
      [
        'an airline moderator with a hotel id',
        Role.AirlineModerator,
        'hotel',
        'airline',
      ],
    ] as const)('refuses %s', async (_name, role, given, expected) => {
      const response = await createModerator({
        ...hotelModerator(),
        role,
        providerId: given === 'airline' ? airlineId : hotelId,
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'providerId',
          messages: [PROVIDER_NOT_FOUND_MESSAGE[expected]],
        },
      ]);
    });

    it('answers 409 for an email that is already registered', async () => {
      const body = hotelModerator();
      await created(body);

      const response = await createModerator({
        ...hotelModerator(),
        email: body.email.toUpperCase(),
      });

      expect(response.status).toBe(409);
    });

    it.each([
      ['a role that is not a moderator role', { role: Role.Admin }, 'role'],
      [
        'a temporary password that breaks the rule',
        { temporaryPassword: 'short' },
        'temporaryPassword',
      ],
      [
        'a provider id that is not an id',
        { providerId: 'hotel-1' },
        'providerId',
      ],
      ['a field the server sets', { status: 'suspended' }, 'status'],
      ['a missing name', { name: null }, 'name'],
    ])('answers 400 for %s', async (_name, change, field) => {
      const response = await createModerator({
        ...hotelModerator(),
        ...change,
      });

      expect(response.status).toBe(400);
      expect(
        (response.body.errors as { field: string }[]).map(
          (error) => error.field,
        ),
      ).toEqual([field]);
    });

    it('is closed to a registered user', async () => {
      expect((await createModerator(hotelModerator(), 'user')).status).toBe(
        403,
      );
    });

    it('needs a login', async () => {
      const response = await createModerator(hotelModerator(), null);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('Swagger', () => {
    it('documents the route and its answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route = response.body.paths[ROUTE].post;
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['201', '400', '401', '403', '409']),
      );
      expect(
        response.body.components.schemas.UserResponseDto.properties,
      ).toHaveProperty('assignment');
    });
  });
});
