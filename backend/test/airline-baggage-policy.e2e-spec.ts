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
import {
  EXTRA_BAG_PRICE_MAX,
  MAX_EXTRA_BAGS_MAX,
} from './../src/flights/flights.constants';
import { Airline } from './../src/flights/models/airline.schema';
import { CabinClass } from './../src/flights/models/cabin-class.enum';
import { FlightStatus } from './../src/flights/models/flight-status.enum';
import { Flight } from './../src/flights/models/flight.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

/** A token unique to this run, in every name, email, code and flight number. */
const RUN = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
/** A logo name no real upload has. The tests never serve it. */
const PLACEHOLDER_LOGO = `flt08-e2e-${RUN}.png`;
let codeCount = 0;
const uniqueCode = (): string => `B${RUN}${(codeCount += 1)}`;

const RULE = { extraBagPrice: 5000, maxExtraBags: 2 };
const TIERS = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
];
const NOT_YOURS = 'You can only change the policy of your assigned airline';

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
interface SwaggerProperty {
  description?: string;
  example?: unknown;
}

describe('Airline extra baggage rule (e2e, FLT-08)', () => {
  let app: NestExpressApplication;
  let airlines: Model<Airline>;
  let users: Model<User>;
  let flights: Model<Flight>;
  /** What these tests created. Each record is deleted by id at the end. */
  const createdAirlineIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdFlightIds: string[] = [];

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
      name: `FLT-08 ${RUN} airline`,
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
      name: `FLT-08 ${RUN} ${role}`,
      email: `flt08-${RUN.toLowerCase()}-${randomUUID()}@example.com`,
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

  const moderatorOf = (id: string) =>
    createActor(Role.AirlineModerator, {
      providerType: ProviderType.Airline,
      providerId: id,
    });

  const putRule = (id: string, body: unknown, cookie?: string) => {
    const call = http().put(`/api/airlines/${id}/baggage-policy`);
    return (cookie ? call.set('Cookie', cookie) : call).send(
      body as Record<string, unknown>,
    );
  };
  const putTiers = (id: string, cookie: string) =>
    http()
      .put(`/api/airlines/${id}/cancellation-policy`)
      .set('Cookie', cookie)
      .send({ tiers: TIERS });

  const storedPolicy = async (id: string) =>
    (await airlines.findById(id).lean().orFail()).policy;

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
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));

    airlineId = await createAirline();
    otherAirlineId = await createAirline();
    moderator = await moderatorOf(airlineId);
    otherModerator = await moderatorOf(otherAirlineId);
    admin = await createActor(Role.Admin);
    user = await createActor(Role.User);
    hotelModerator = await createActor(Role.HotelModerator, {
      providerType: ProviderType.Hotel,
      providerId: new Types.ObjectId().toString(),
    });
  });

  afterAll(async () => {
    for (const id of createdFlightIds) {
      await flights.deleteOne({ _id: id });
    }
    for (const id of createdAirlineIds) {
      await airlines.deleteOne({ _id: id });
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.deleteOne({ _id: id });
    }
    await app.close();
  });

  it('shows no extra-bag rule for an airline whose moderator has not set one', async () => {
    const response = await http().get(`/api/airlines/${otherAirlineId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      extraBagPrice: null,
      maxExtraBags: 0,
    });
  });

  it('lets the assigned moderator set the rule, stores it and shows it to guests', async () => {
    const response = await putRule(airlineId, RULE, moderator.cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: airlineId,
      ...RULE,
      extraBagCurrency: 'USD',
    });
    expect(response.body).not.toHaveProperty('policy');
    expect(await storedPolicy(airlineId)).toMatchObject(RULE);

    const guest = await http().get(`/api/airlines/${airlineId}`);
    expect(guest.status).toBe(200);
    expect(guest.body).toMatchObject(RULE);
  });

  it('accepts 0 extra bags and keeps the price', async () => {
    const id = await createAirline();
    const owner = await moderatorOf(id);

    const response = await putRule(
      id,
      { extraBagPrice: 2500, maxExtraBags: 0 },
      owner.cookie,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      extraBagPrice: 2500,
      maxExtraBags: 0,
    });
    expect(await storedPolicy(id)).toMatchObject({
      extraBagPrice: 2500,
      maxExtraBags: 0,
    });
  });

  it('accepts the limits, 1 cent and the highest price, 0 and the most bags', async () => {
    const id = await createAirline();
    const owner = await moderatorOf(id);

    await putRule(
      id,
      { extraBagPrice: 1, maxExtraBags: 0 },
      owner.cookie,
    ).expect(200);
    const top = await putRule(
      id,
      { extraBagPrice: EXTRA_BAG_PRICE_MAX, maxExtraBags: MAX_EXTRA_BAGS_MAX },
      owner.cookie,
    );
    expect(top.status).toBe(200);
    expect(top.body).toMatchObject({
      extraBagPrice: EXTRA_BAG_PRICE_MAX,
      maxExtraBags: MAX_EXTRA_BAGS_MAX,
    });
  });

  it('replaces the rule: the second PUT is what is stored', async () => {
    const id = await createAirline();
    const owner = await moderatorOf(id);
    await putRule(id, RULE, owner.cookie).expect(200);

    const response = await putRule(
      id,
      { extraBagPrice: 7500, maxExtraBags: 1 },
      owner.cookie,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      extraBagPrice: 7500,
      maxExtraBags: 1,
    });
    expect(await storedPolicy(id)).toMatchObject({
      extraBagPrice: 7500,
      maxExtraBags: 1,
    });
  });

  describe('the two policy routes never overwrite each other', () => {
    it('cancellation tiers first, then the extra-bag rule: the tiers stay', async () => {
      const id = await createAirline();
      const owner = await moderatorOf(id);
      await putTiers(id, owner.cookie).expect(200);

      const response = await putRule(id, RULE, owner.cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        cancellationTiers: TIERS,
        ...RULE,
      });
      expect(await storedPolicy(id)).toMatchObject({
        cancellationTiers: TIERS,
        ...RULE,
      });
    });

    it('extra-bag rule first, then the cancellation tiers: the rule stays', async () => {
      const id = await createAirline();
      const owner = await moderatorOf(id);
      await putRule(id, RULE, owner.cookie).expect(200);

      const response = await putTiers(id, owner.cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        cancellationTiers: TIERS,
        ...RULE,
      });
      expect(await storedPolicy(id)).toMatchObject({
        cancellationTiers: TIERS,
        ...RULE,
      });
    });
  });

  describe('an airline stored before FLT-08 (and before FLT-09: no policy at all)', () => {
    let oldId: string;

    beforeAll(async () => {
      const _id = new Types.ObjectId();
      oldId = _id.toString();
      const now = new Date();
      // Straight into the collection, so no schema default adds a policy.
      await airlines.collection.insertOne({
        _id,
        name: `FLT-08 ${RUN} old airline`,
        code: uniqueCode(),
        logo: PLACEHOLDER_LOGO,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      createdAirlineIds.push(oldId);
    });

    it('reads as selling no extra bag', async () => {
      const response = await http().get(`/api/airlines/${oldId}`).expect(200);

      expect(response.body).toMatchObject({
        cancellationTiers: [],
        extraBagPrice: null,
        maxExtraBags: 0,
      });
    });

    it('takes a rule from its moderator, and gets a policy with it', async () => {
      const owner = await moderatorOf(oldId);

      const response = await putRule(oldId, RULE, owner.cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ cancellationTiers: [], ...RULE });
      expect(await storedPolicy(oldId)).toMatchObject(RULE);
    });
  });

  it('leaves the flights of the airline exactly as they were', async () => {
    const id = await createAirline();
    const owner = await moderatorOf(id);
    const departureAt = new Date(Date.now() + 40 * 24 * 3_600_000);
    const flight = await flights.create({
      airlineId: new Types.ObjectId(id),
      flightNumber: `B${RUN.slice(0, 6)}`,
      departureAirport: 'AAA',
      arrivalAirport: 'BBB',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 3_600_000),
      departureDateLocal: departureAt.toISOString().slice(0, 10),
      status: FlightStatus.Scheduled,
      cabins: [
        {
          cabin: CabinClass.Economy,
          totalSeats: 100,
          bookedSeats: 7,
          heldSeats: 2,
          price: 25000,
          freeBags: 1,
          maxBagKg: 23,
        },
      ],
    });
    createdFlightIds.push(flight._id.toString());
    const before = await flights.findById(flight._id).lean().orFail();

    await putRule(id, RULE, owner.cookie).expect(200);

    expect(await flights.findById(flight._id).lean().orFail()).toEqual(before);
  });

  describe('who may set it: the same answers as the cancellation policy (FLT-09)', () => {
    it('answers 401 to a guest and stores nothing', async () => {
      const before = await storedPolicy(otherAirlineId);

      const response = await putRule(otherAirlineId, RULE);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      expect(await storedPolicy(otherAirlineId)).toEqual(before);
    });

    it.each([
      ['a registered user', () => user],
      ['an administrator', () => admin],
      ['a hotel moderator', () => hotelModerator],
    ])(
      'answers 403 to %s (role guard) and stores nothing',
      async (_label, actor) => {
        const before = await storedPolicy(otherAirlineId);

        const response = await putRule(otherAirlineId, RULE, actor().cookie);
        const tiers = await http()
          .put(`/api/airlines/${otherAirlineId}/cancellation-policy`)
          .set('Cookie', actor().cookie)
          .send({ tiers: TIERS });

        expect(response.status).toBe(403);
        expect(tiers.status).toBe(403);
        expect(response.body.message).toBe(tiers.body.message);
        expect(await storedPolicy(otherAirlineId)).toEqual(before);
      },
    );

    it('answers 403 to the moderator of another airline and stores nothing', async () => {
      const before = await storedPolicy(otherAirlineId);

      const response = await putRule(otherAirlineId, RULE, moderator.cookie);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(NOT_YOURS);
      expect(await storedPolicy(otherAirlineId)).toEqual(before);
      // The other airline's own moderator is still allowed.
      await putRule(otherAirlineId, RULE, otherModerator.cookie).expect(200);
      await http()
        .put(`/api/airlines/${otherAirlineId}/baggage-policy`)
        .set('Cookie', otherModerator.cookie)
        .send({ extraBagPrice: 1, maxExtraBags: 0 })
        .expect(200);
    });

    it('answers 404 for an airline that does not exist and 400 for a malformed id', async () => {
      const missing = await putRule(
        new Types.ObjectId().toString(),
        RULE,
        moderator.cookie,
      );
      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe('Airline not found');

      const malformed = await putRule('not-an-id', RULE, moderator.cookie);
      expect(malformed.status).toBe(400);
    });
  });

  describe('400 in the project error shape, nothing stored', () => {
    it.each([
      ['a price of 0', { extraBagPrice: 0 }, 'extraBagPrice'],
      ['a negative price', { extraBagPrice: -1 }, 'extraBagPrice'],
      ['a fractional price', { extraBagPrice: 12.5 }, 'extraBagPrice'],
      ['a price as text', { extraBagPrice: '5000' }, 'extraBagPrice'],
      ['a null price', { extraBagPrice: null }, 'extraBagPrice'],
      ['a missing price', { extraBagPrice: undefined }, 'extraBagPrice'],
      [
        'a price above the limit',
        { extraBagPrice: EXTRA_BAG_PRICE_MAX + 1 },
        'extraBagPrice',
      ],
      ['a negative maximum', { maxExtraBags: -1 }, 'maxExtraBags'],
      ['a fractional maximum', { maxExtraBags: 1.5 }, 'maxExtraBags'],
      ['a maximum as text', { maxExtraBags: '2' }, 'maxExtraBags'],
      ['a null maximum', { maxExtraBags: null }, 'maxExtraBags'],
      ['a missing maximum', { maxExtraBags: undefined }, 'maxExtraBags'],
      [
        'a maximum above the limit',
        { maxExtraBags: MAX_EXTRA_BAGS_MAX + 1 },
        'maxExtraBags',
      ],
      ['a currency', { currency: 'USD' }, 'currency'],
      ['a weight', { maxBagKg: 23 }, 'maxBagKg'],
      ['cancellation tiers', { cancellationTiers: TIERS }, 'cancellationTiers'],
      ['the active flag', { active: false }, 'active'],
    ])('refuses %s', async (_label, change, field) => {
      const before = await storedPolicy(airlineId);

      const response = await putRule(
        airlineId,
        { ...RULE, ...change },
        moderator.cookie,
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toEqual([
        { field, messages: expect.any(Array) },
      ]);
      expect(await storedPolicy(airlineId)).toEqual(before);
    });
  });

  it('documents the route, the weight rule and the public profile in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const put = paths['/api/airlines/{id}/baggage-policy'].put;
    const get = paths['/api/airlines/{id}'].get;
    const schemas = response.body.components.schemas as Record<
      string,
      { properties: Record<string, SwaggerProperty>; required?: string[] }
    >;

    expect(put.tags).toEqual(['Airlines']);
    expect(put.description).toMatch(/^FLT-08 /);
    expect(put.description).toContain('maxBagKg');
    expect(put.security).toEqual([{ cookie: [] }]);
    expect(Object.keys(put.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
    expect(get.security ?? []).toEqual([]);

    const body = schemas.UpdateBaggagePolicyDto;
    expect(Object.keys(body.properties)).toEqual([
      'extraBagPrice',
      'maxExtraBags',
    ]);
    expect(body.required).toEqual(['extraBagPrice', 'maxExtraBags']);
    for (const property of Object.values(body.properties)) {
      expect(property.description).toContain('maxBagKg');
      expect(property.example).toBeDefined();
    }
    const airline = schemas.AirlineResponseDto.properties;
    for (const field of ['extraBagPrice', 'maxExtraBags']) {
      expect(airline[field].description).toContain('maxBagKg');
      expect(airline[field].example).toBeDefined();
    }
    expect(airline.extraBagCurrency.example).toBe('USD');
    expect(airline.extraBagCurrency.description).toBeDefined();
    expect(schemas.CabinResponseDto.properties.maxBagKg.description).toContain(
      'extra bag',
    );
  });
});
