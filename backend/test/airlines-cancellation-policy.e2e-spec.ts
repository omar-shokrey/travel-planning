import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { Airline } from './../src/flights/models/airline.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

/** A logo name no real upload has. The tests never serve it. */
const PLACEHOLDER_LOGO = `flt09-e2e-${randomUUID()}.png`;
const uniqueCode = (): string =>
  `T${randomUUID().replaceAll('-', '').slice(0, 9).toUpperCase()}`;

const POLICY = [
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 1, refundPercent: 25 },
];
/** The same tiers, as they are stored and returned: highest threshold first. */
const SORTED_POLICY = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 1, refundPercent: 25 },
];

interface Actor {
  id: string;
  cookie: string;
}

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  security?: unknown[];
  responses: Record<string, unknown>;
}

describe('Airline cancellation policy (e2e, FLT-09)', () => {
  let app: NestExpressApplication;
  let airlines: Model<Airline>;
  let users: Model<User>;
  /** What these tests created. Each record is deleted by id at the end. */
  const createdAirlineIds: string[] = [];
  const createdUserIds: string[] = [];

  let airlineId: string;
  let otherAirlineId: string;
  let moderator: Actor;
  let otherModerator: Actor;
  let admin: Actor;
  let user: Actor;
  let hotelModerator: Actor;

  const http = () => request(app.getHttpServer());

  const createAirline = async (): Promise<string> => {
    const airline = await airlines.create({
      name: 'FLT-09 Test Airline',
      code: uniqueCode(),
      logo: PLACEHOLDER_LOGO,
    });
    const id = airline._id.toString();
    createdAirlineIds.push(id);
    return id;
  };

  const createActor = async (
    role: Role,
    assignment?: { providerType: ProviderType; providerId: string },
  ): Promise<Actor> => {
    const created = await users.create({
      name: `FLT-09 ${role}`,
      email: `flt09-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(assignment && {
        assignment: {
          providerType: assignment.providerType,
          providerId: new Types.ObjectId(assignment.providerId),
        },
      }),
    });
    const id = created._id.toString();
    createdUserIds.push(id);
    return { id, cookie: await sessionCookieFor(app, id) };
  };

  const putPolicy = (id: string, body: unknown, cookie?: string) => {
    const call = http().put(`/api/airlines/${id}/cancellation-policy`);
    return (cookie ? call.set('Cookie', cookie) : call).send(
      body as Record<string, unknown>,
    );
  };

  const storedTiers = async (id: string) =>
    (await airlines.findById(id).lean().orFail()).policy?.cancellationTiers ??
    [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    users = app.get<Model<User>>(getModelToken(User.name));

    airlineId = await createAirline();
    otherAirlineId = await createAirline();
    moderator = await createActor(Role.AirlineModerator, {
      providerType: ProviderType.Airline,
      providerId: airlineId,
    });
    otherModerator = await createActor(Role.AirlineModerator, {
      providerType: ProviderType.Airline,
      providerId: otherAirlineId,
    });
    admin = await createActor(Role.Admin);
    user = await createActor(Role.User);
    hotelModerator = await createActor(Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: new Types.ObjectId().toString(),
    });
  });

  afterAll(async () => {
    for (const id of createdAirlineIds) {
      await airlines.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('shows an empty policy for an airline that has none', async () => {
    const response = await http().get(`/api/airlines/${otherAirlineId}`);

    expect(response.status).toBe(200);
    expect(response.body.cancellationTiers).toEqual([]);
  });

  it('lets the assigned moderator save the tiers, sorted by threshold, and shows them to everyone', async () => {
    const response = await putPolicy(
      airlineId,
      { tiers: POLICY },
      moderator.cookie,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: airlineId,
      cancellationTiers: SORTED_POLICY,
    });
    expect(await storedTiers(airlineId)).toEqual(SORTED_POLICY);

    const guest = await http().get(`/api/airlines/${airlineId}`);
    expect(guest.status).toBe(200);
    expect(guest.body.cancellationTiers).toEqual(SORTED_POLICY);
  });

  it('replaces the whole list and does not merge it with the old one', async () => {
    await putPolicy(airlineId, { tiers: POLICY }, moderator.cookie).expect(200);

    const response = await putPolicy(
      airlineId,
      { tiers: [{ daysBefore: 14, refundPercent: 80 }] },
      moderator.cookie,
    );

    expect(response.status).toBe(200);
    expect(response.body.cancellationTiers).toEqual([
      { daysBefore: 14, refundPercent: 80 },
    ]);
    expect(await storedTiers(airlineId)).toEqual([
      { daysBefore: 14, refundPercent: 80 },
    ]);
  });

  it('clears the policy with an empty list', async () => {
    await putPolicy(airlineId, { tiers: POLICY }, moderator.cookie).expect(200);

    const response = await putPolicy(
      airlineId,
      { tiers: [] },
      moderator.cookie,
    );

    expect(response.status).toBe(200);
    expect(response.body.cancellationTiers).toEqual([]);
    expect(await storedTiers(airlineId)).toEqual([]);
  });

  it('changes nothing but the policy', async () => {
    const before = await airlines.findById(airlineId).lean().orFail();

    await putPolicy(airlineId, { tiers: POLICY }, moderator.cookie).expect(200);

    const after = await airlines.findById(airlineId).lean().orFail();
    expect(after.name).toBe(before.name);
    expect(after.code).toBe(before.code);
    expect(after.logo).toBe(before.logo);
    expect(after.active).toBe(before.active);
  });

  describe('invalid tiers', () => {
    beforeAll(async () => {
      await putPolicy(
        airlineId,
        { tiers: SORTED_POLICY },
        moderator.cookie,
      ).expect(200);
    });

    it.each([
      [
        'two tiers with the same threshold',
        {
          tiers: [
            { daysBefore: 7, refundPercent: 100 },
            { daysBefore: 7, refundPercent: 50 },
          ],
        },
      ],
      [
        'a negative threshold',
        { tiers: [{ daysBefore: -1, refundPercent: 10 }] },
      ],
      [
        'a fractional threshold',
        { tiers: [{ daysBefore: 2.5, refundPercent: 10 }] },
      ],
      [
        'a refund above 100%',
        { tiers: [{ daysBefore: 3, refundPercent: 101 }] },
      ],
      ['a negative refund', { tiers: [{ daysBefore: 3, refundPercent: -1 }] }],
      [
        'numbers sent as text',
        { tiers: [{ daysBefore: '3', refundPercent: '50' }] },
      ],
      ['no tiers', {}],
      ['tiers that are not a list', { tiers: 'none' }],
      [
        'more than 20 tiers',
        {
          tiers: Array.from({ length: 21 }, (_, index) => ({
            daysBefore: index,
            refundPercent: 10,
          })),
        },
      ],
      [
        'a field the client may not send',
        { tiers: [], airlineId: new Types.ObjectId().toString() },
      ],
    ])(
      'refuses %s with 400 and keeps the stored policy',
      async (_label, body) => {
        const response = await putPolicy(airlineId, body, moderator.cookie);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Validation failed');
        expect(await storedTiers(airlineId)).toEqual(SORTED_POLICY);
      },
    );

    it('names the repeated threshold', async () => {
      const response = await putPolicy(
        airlineId,
        {
          tiers: [
            { daysBefore: 7, refundPercent: 100 },
            { daysBefore: 7, refundPercent: 50 },
          ],
        },
        moderator.cookie,
      );

      expect(response.body.errors).toEqual([
        {
          field: 'tiers',
          messages: [
            'Each tier must have a different daysBefore: 7 appears more than once',
          ],
        },
      ]);
    });
  });

  describe('who may set it', () => {
    beforeAll(async () => {
      await putPolicy(
        airlineId,
        { tiers: SORTED_POLICY },
        moderator.cookie,
      ).expect(200);
    });

    it('refuses the moderator of another airline with 403', async () => {
      const response = await putPolicy(
        airlineId,
        { tiers: [] },
        otherModerator.cookie,
      );

      expect(response.status).toBe(403);
      expect(await storedTiers(airlineId)).toEqual(SORTED_POLICY);
    });

    it('refuses an administrator, a user and a hotel moderator with 403', async () => {
      for (const actor of [admin, user, hotelModerator]) {
        const response = await putPolicy(
          airlineId,
          { tiers: [] },
          actor.cookie,
        );
        expect(response.status).toBe(403);
      }
      expect(await storedTiers(airlineId)).toEqual(SORTED_POLICY);
    });

    it('refuses a guest with 401', async () => {
      const response = await putPolicy(airlineId, { tiers: [] });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(await storedTiers(airlineId)).toEqual(SORTED_POLICY);
    });

    it('answers 404 for an airline that does not exist', async () => {
      const response = await putPolicy(
        new Types.ObjectId().toString(),
        { tiers: [] },
        moderator.cookie,
      );

      expect(response.status).toBe(404);
    });

    it('answers 400 for an id that is not a valid id', async () => {
      const response = await putPolicy(
        'not-an-id',
        { tiers: [] },
        moderator.cookie,
      );

      expect(response.status).toBe(400);
    });
  });

  it('documents the route in Swagger with the requirement ID and its answers', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const operation = response.body.paths[
      '/api/airlines/{id}/cancellation-policy'
    ].put as SwaggerOperation;

    expect(operation.tags).toEqual(['Airlines']);
    expect(operation.description).toMatch(/^FLT-09\. /);
    expect(operation.security).toEqual([{ cookie: [] }]);
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
    expect(
      Object.keys(
        response.body.components.schemas.AirlineResponseDto.properties,
      ),
    ).toContain('cancellationTiers');
  });
});
