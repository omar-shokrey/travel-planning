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

const range = (from: string, to: string) => ({ from, to });
const firstRange = () => range('2026-12-01', '2026-12-08');

describe('Room availability ranges (e2e, HTL-04)', () => {
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
  let managedRoomId: string;
  let otherRoomId: string;

  const call = (
    hotelId: string,
    roomId: string,
    who: string | undefined,
    body: Record<string, unknown>,
  ) => {
    const pending = request(app.getHttpServer())
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .send(body);
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
        name: `HTL-04 managed hotel ${RUN}`,
        addressLine: '12 Nile Street',
        cityId: 'htl04-test-city',
        countryCode: 'HTL04',
        description: 'A hotel created by the HTL-04 e2e test.',
        photos: [],
        starClass: 4,
        amenities: [],
      },
      {
        name: `HTL-04 other hotel ${RUN}`,
        addressLine: '13 Nile Street',
        cityId: 'htl04-test-city',
        countryCode: 'HTL04',
        description: 'A second hotel created by the HTL-04 e2e test.',
        photos: [],
        starClass: 4,
        amenities: [],
      },
    ]);
    managedHotelId = managed._id.toString();
    otherHotelId = otherHotel._id.toString();
    createdHotelIds.push(managedHotelId, otherHotelId);

    const [managedRoom, otherRoom] = await rooms.insertMany([
      {
        hotelId: managed._id,
        number: `HTL04-A-${RUN}`,
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        pricePerNight: 12500,
      },
      {
        hotelId: otherHotel._id,
        number: `HTL04-B-${RUN}`,
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        pricePerNight: 12500,
      },
    ]);
    managedRoomId = managedRoom._id.toString();
    otherRoomId = otherRoom._id.toString();
    createdRoomIds.push(managedRoomId, otherRoomId);

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
        name: `HTL-04 ${label}`,
        email: `htl04-${label}-${randomUUID()}@example.com`,
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

  beforeEach(async () => {
    await rooms.updateOne(
      { _id: managedRoomId },
      { $set: { availability: [] } },
    );
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

  it('adds a valid date-only range and returns the updated room', async () => {
    const availability = firstRange();
    const response = await call(
      managedHotelId,
      managedRoomId,
      'assigned',
      availability,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: managedRoomId,
      hotelId: managedHotelId,
      currency: 'USD',
      availability: [availability],
    });
    expect(response.body.createdAt).toMatch(/Z$/);
    expect(
      (await rooms.findById(managedRoomId).lean().orFail()).availability,
    ).toEqual([availability]);
  });

  it('allows adjacent ranges under inclusive-start, exclusive-end semantics', async () => {
    const first = range('2026-12-01', '2026-12-08');
    const second = range('2026-12-08', '2026-12-12');

    const firstResponse = await call(
      managedHotelId,
      managedRoomId,
      'assigned',
      first,
    );
    const secondResponse = await call(
      managedHotelId,
      managedRoomId,
      'assigned',
      second,
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body.availability).toEqual([first, second]);
  });

  it('returns availability sorted when an earlier range is added after a later one', async () => {
    const later = range('2026-12-15', '2026-12-20');
    const earlier = range('2026-12-01', '2026-12-08');

    const laterResponse = await call(
      managedHotelId,
      managedRoomId,
      'assigned',
      later,
    );
    const earlierResponse = await call(
      managedHotelId,
      managedRoomId,
      'assigned',
      earlier,
    );

    expect(laterResponse.status).toBe(201);
    expect(earlierResponse.status).toBe(201);
    expect(earlierResponse.body).toMatchObject({
      currency: 'USD',
      availability: [earlier, later],
    });
    expect(
      (await rooms.findById(managedRoomId).lean().orFail()).availability,
    ).toEqual([earlier, later]);
  });

  it('rejects overlapping ranges with 409', async () => {
    const first = firstRange();
    await call(managedHotelId, managedRoomId, 'assigned', first);

    const response = await call(
      managedHotelId,
      managedRoomId,
      'assigned',
      range('2026-12-07', '2026-12-10'),
    );

    expect(response.status).toBe(409);
    expect(
      (await rooms.findById(managedRoomId).lean().orFail()).availability,
    ).toEqual([first]);
  });

  it('allows only one of two concurrent overlapping requests', async () => {
    const results = await Promise.all([
      call(managedHotelId, managedRoomId, 'assigned', firstRange()),
      call(managedHotelId, managedRoomId, 'assigned', firstRange()),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(
      (await rooms.findById(managedRoomId).lean().orFail()).availability,
    ).toEqual([firstRange()]);
  });

  it.each([
    [{ from: '2026-12-08', to: '2026-12-01' }],
    [{ from: '2026-12-01', to: '2026-12-01' }],
    [{ from: '2026-02-30', to: '2026-03-08' }],
    [{ from: '2026-12-01T00:00:00Z', to: '2026-12-08' }],
    [{ from: '2026-12-01', to: '2026-12-08', active: true }],
  ])('rejects invalid range input %j with 400', async (body) => {
    const response = await call(
      managedHotelId,
      managedRoomId,
      'assigned',
      body,
    );

    expect(response.status).toBe(400);
  });

  it.each(['admin', 'user', 'airlineModerator', 'otherModerator'])(
    'forbids %s from defining availability',
    async (who) => {
      const response = await call(
        managedHotelId,
        managedRoomId,
        who,
        firstRange(),
      );

      expect(response.status).toBe(403);
    },
  );

  it('returns 404 for an unknown hotel', async () => {
    const response = await call(
      new Types.ObjectId().toString(),
      managedRoomId,
      'assigned',
      firstRange(),
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 when the room does not belong to the hotel', async () => {
    const response = await call(
      managedHotelId,
      otherRoomId,
      'assigned',
      firstRange(),
    );

    expect(response.status).toBe(404);
  });

  it('requires a login', async () => {
    const response = await call(
      managedHotelId,
      managedRoomId,
      undefined,
      firstRange(),
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
  });

  it('documents the endpoint and DTO in Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');

    expect(response.status).toBe(200);
    const operation =
      response.body.paths['/api/hotels/{id}/rooms/{roomId}/availability'].post;
    expect(operation.summary).toBe('Add a bookable date range to a room');
    expect(operation.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/CreateRoomAvailabilityDto',
    );
    expect(
      operation.responses['201'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/RoomResponseDto');
    const roomSchema = response.body.components.schemas.RoomResponseDto;
    expect(roomSchema.properties.currency).toMatchObject({
      type: 'string',
      example: 'USD',
    });
    expect(roomSchema.properties.availability.items.$ref).toBe(
      '#/components/schemas/RoomAvailabilityResponseDto',
    );
  });
});
