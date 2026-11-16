import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { Room } from './../src/hotels/models/room.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const RUN = randomUUID().slice(0, 8);

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

const validRoom = () => ({
  number: `101-${RUN}`,
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
});

describe('Hotel rooms (e2e, HTL-03)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  const cookies = new Map<string, string>();
  let managedHotelId: string;
  let otherHotelId: string;

  const call = (
    path: string,
    who: string | undefined,
    body: Record<string, unknown>,
  ) => {
    const pending = request(app.getHttpServer()).post(path).send(body);
    return who ? pending.set('Cookie', cookies.get(who) ?? '') : pending;
  };

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
    rooms = app.get<Model<Room>>(getModelToken(Room.name));
    await rooms.createIndexes();

    const [managed, otherHotel] = await hotels.insertMany([
      {
        name: `HTL-03 managed hotel ${RUN}`,
        addressLine: '12 Nile Street',
        cityId: 'htl03-test-city',
        countryCode: 'HTL03',
        description: 'A hotel created by the HTL-03 room e2e test.',
        photos: [],
        starClass: 4,
        amenities: [],
      },
      {
        name: `HTL-03 other hotel ${RUN}`,
        addressLine: '13 Nile Street',
        cityId: 'htl03-test-city',
        countryCode: 'HTL03',
        description: 'A second hotel created by the HTL-03 room e2e test.',
        photos: [],
        starClass: 4,
        amenities: [],
      },
    ]);
    managedHotelId = managed._id.toString();
    otherHotelId = otherHotel._id.toString();
    createdHotelIds.push(managedHotelId, otherHotelId);

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['admin', Role.Admin, undefined],
      ['user', Role.User, undefined],
      ['assigned', Role.HotelModerator, managed._id],
      ['otherModerator', Role.HotelModerator, otherHotel._id],
      ['airlineModerator', Role.AirlineModerator, undefined],
    ];
    const inserted = await users.insertMany(
      accounts.map(([label, role, hotelId]) => ({
        name: `HTL-03 ${label}`,
        email: `htl03-${label}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...(hotelId && {
          assignment: { providerType: ProviderType.Hotel, providerId: hotelId },
        }),
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD });
      expect(login.status).toBe(200);
      cookies.set(
        accounts[index][0],
        `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
      );
    }
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await rooms.findByIdAndDelete(id);
    }
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('creates an active room attached to the assigned hotel', async () => {
    const room = validRoom();
    const response = await call(
      `/api/hotels/${managedHotelId}/rooms`,
      'assigned',
      room,
    );

    expect(response.status).toBe(201);
    createdRoomIds.push(response.body.id as string);
    expect(response.body).toMatchObject({
      hotelId: managedHotelId,
      ...room,
      currency: 'USD',
      active: true,
    });
    expect(response.body.createdAt).toMatch(/Z$/);
    const stored = await rooms.findById(response.body.id).lean().orFail();
    expect(stored.hotelId.toString()).toBe(managedHotelId);
    expect(stored.active).toBe(true);
  });

  it('rejects client-controlled fields', async () => {
    const response = await call(
      `/api/hotels/${managedHotelId}/rooms`,
      'assigned',
      { ...validRoom(), active: false, hotelId: otherHotelId },
    );

    expect(response.status).toBe(400);
    expect(
      response.body.errors.map(({ field }: { field: string }) => field),
    ).toEqual(['active', 'hotelId']);
  });

  it('rejects duplicate room numbers within one hotel with 409', async () => {
    const roomNumber = `duplicate-${RUN}`;
    const first = await call(
      `/api/hotels/${managedHotelId}/rooms`,
      'assigned',
      { ...validRoom(), number: roomNumber },
    );
    expect(first.status).toBe(201);
    createdRoomIds.push(first.body.id as string);

    const duplicate = await call(
      `/api/hotels/${managedHotelId}/rooms`,
      'assigned',
      { ...validRoom(), number: roomNumber },
    );
    if (duplicate.status === 201) {
      createdRoomIds.push(duplicate.body.id as string);
    }

    expect(duplicate.status).toBe(409);
  });

  it('allows the same room number at another hotel', async () => {
    const roomNumber = `shared-${RUN}`;
    const first = await call(
      `/api/hotels/${managedHotelId}/rooms`,
      'assigned',
      { ...validRoom(), number: roomNumber },
    );
    expect(first.status).toBe(201);
    createdRoomIds.push(first.body.id as string);

    const second = await call(
      `/api/hotels/${otherHotelId}/rooms`,
      'otherModerator',
      { ...validRoom(), number: roomNumber },
    );
    if (second.status === 201) {
      createdRoomIds.push(second.body.id as string);
    }

    expect(second.status).toBe(201);
    expect(second.body.hotelId).toBe(otherHotelId);
  });

  it('documents the route and DTO in Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');

    expect(response.status).toBe(200);
    const operation = response.body.paths['/api/hotels/{id}/rooms'].post;
    expect(operation.summary).toBe('Add a room to an assigned hotel');
    expect(operation.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/CreateRoomDto',
    );
    expect(
      operation.responses['201'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/RoomResponseDto');
  });

  it('refuses a moderator assigned to another hotel', async () => {
    const response = await call(
      `/api/hotels/${managedHotelId}/rooms`,
      'otherModerator',
      validRoom(),
    );

    expect(response.status).toBe(403);
  });

  it.each(['admin', 'user', 'airlineModerator'])(
    'refuses a %s',
    async (who) => {
      const response = await call(
        `/api/hotels/${managedHotelId}/rooms`,
        who,
        validRoom(),
      );

      expect(response.status).toBe(403);
    },
  );

  it('returns 404 for an unknown hotel', async () => {
    const response = await call(
      `/api/hotels/${new Types.ObjectId().toString()}/rooms`,
      'assigned',
      validRoom(),
    );

    expect(response.status).toBe(404);
  });

  it('requires a login', async () => {
    const response = await call(
      `/api/hotels/${managedHotelId}/rooms`,
      undefined,
      validRoom(),
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
  });
});
