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
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { todayUtc } from './../src/hotels/room-dates';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const RUN = randomUUID().slice(0, 8);

const range = (from: string, to: string) => ({ from, to });

describe('Block dates, deactivate or delete a room (e2e, HTL-06)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  const cookies = new Map<string, string>();

  let hotelId: string;
  let otherHotelId: string;

  const as = (who: string | undefined, call: request.Test) =>
    who ? call.set('Cookie', cookies.get(who) ?? '') : call;

  const block = (who: string | undefined, roomId: string, blocked: unknown) =>
    as(
      who,
      request(app.getHttpServer())
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .send({ blocked } as object),
    );

  const deactivate = (who: string | undefined, roomId: string) =>
    as(
      who,
      request(app.getHttpServer()).patch(
        `/api/hotels/${hotelId}/rooms/${roomId}/deactivate`,
      ),
    );

  const reactivate = (who: string | undefined, roomId: string) =>
    as(
      who,
      request(app.getHttpServer()).patch(
        `/api/hotels/${hotelId}/rooms/${roomId}/reactivate`,
      ),
    );

  const remove = (who: string | undefined, roomId: string) =>
    as(
      who,
      request(app.getHttpServer()).delete(
        `/api/hotels/${hotelId}/rooms/${roomId}`,
      ),
    );

  /** A fresh room of the managed hotel, bookable for all of December. */
  const createRoom = async (owner = hotelId): Promise<string> => {
    const room = await rooms.create({
      hotelId: new Types.ObjectId(owner),
      number: `HTL06-${randomUUID().slice(0, 8)}`,
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      availability: [range('2026-12-01', '2027-01-01')],
    });
    const id = room._id.toString();
    createdRoomIds.push(id);
    return id;
  };

  /** A night of a room that a reservation holds or has booked. */
  const reserveNight = async (
    roomId: string,
    date: string,
    state: RoomNightState = RoomNightState.Booked,
    holdExpiresAt?: Date,
  ): Promise<void> => {
    await roomNights.create({
      roomId: new Types.ObjectId(roomId),
      hotelId: new Types.ObjectId(hotelId),
      date,
      state,
      bookingId: new Types.ObjectId(),
      holdExpiresAt,
    });
  };

  const nightsOfRoom = (roomId: string) =>
    roomNights
      .find({ roomId: new Types.ObjectId(roomId) })
      .sort({ date: 1 })
      .lean()
      .exec();

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
    roomNights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    // The unique (roomId, date) index must exist before blocks are inserted.
    await roomNights.init();

    const hotel = (label: string) => ({
      name: `HTL-06 ${label} hotel ${RUN}`,
      addressLine: '12 Nile Street',
      cityId: 'htl06-test-city',
      countryCode: 'HTL06',
      description: 'A hotel created by the HTL-06 e2e test.',
      photos: [],
      starClass: 4,
      amenities: [],
    });
    const [managed, other] = await hotels.insertMany([
      hotel('managed'),
      hotel('other'),
    ]);
    hotelId = managed._id.toString();
    otherHotelId = other._id.toString();
    createdHotelIds.push(hotelId, otherHotelId);

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['moderator', Role.HotelModerator, managed._id],
      ['otherModerator', Role.HotelModerator, other._id],
      ['user', Role.User, undefined],
    ];
    for (const [label, role, assignedHotel] of accounts) {
      const email = `htl06-${label}-${randomUUID()}@example.com`;
      const user = await users.create({
        name: `HTL-06 ${label}`,
        email,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        ...(assignedHotel && {
          assignment: {
            providerType: ProviderType.Hotel,
            providerId: assignedHotel,
          },
        }),
      });
      createdUserIds.push(user._id.toString());

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      const header = login.headers['set-cookie'] as unknown as string[];
      const accessCookie = header
        .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`))
        ?.split(';')[0];
      expect(accessCookie).toBeDefined();
      cookies.set(label, accessCookie!);
    }
  });

  afterAll(async () => {
    // The nights of the rooms this file created, one room at a time.
    for (const id of createdRoomIds) {
      await roomNights.deleteMany({ roomId: new Types.ObjectId(id) });
      await rooms.findByIdAndDelete(id);
    }
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('blocking dates (PATCH /api/hotels/:id/rooms/:roomId/availability)', () => {
    it('blocks a date range and shows it on the room', async () => {
      const roomId = await createRoom();

      const response = await block('moderator', roomId, [
        range('2026-12-10', '2026-12-13'),
      ]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: roomId,
        blocked: [range('2026-12-10', '2026-12-13')],
        availability: [range('2026-12-01', '2027-01-01')],
      });
      const nights = await nightsOfRoom(roomId);
      expect(nights.map((night) => [night.date, night.state])).toEqual([
        ['2026-12-10', RoomNightState.Blocked],
        ['2026-12-11', RoomNightState.Blocked],
        ['2026-12-12', RoomNightState.Blocked],
      ]);
    });

    it('replaces the blocks: keeps, adds and removes nights', async () => {
      const roomId = await createRoom();
      await block('moderator', roomId, [range('2026-12-10', '2026-12-13')]);

      const response = await block('moderator', roomId, [
        range('2026-12-12', '2026-12-14'),
      ]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        blocked: [range('2026-12-12', '2026-12-14')],
      });
      const nights = await nightsOfRoom(roomId);
      expect(nights.map((night) => night.date)).toEqual([
        '2026-12-12',
        '2026-12-13',
      ]);
    });

    it('removes every block with an empty list', async () => {
      const roomId = await createRoom();
      await block('moderator', roomId, [range('2026-12-10', '2026-12-13')]);

      const response = await block('moderator', roomId, []);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ blocked: [] });
      expect(await nightsOfRoom(roomId)).toEqual([]);
    });

    it('answers 409 and blocks nothing when a range covers a confirmed reservation', async () => {
      const roomId = await createRoom();
      await reserveNight(roomId, '2026-12-11');

      const response = await block('moderator', roomId, [
        range('2026-12-10', '2026-12-13'),
      ]);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        message: 'Nights with a reservation cannot be blocked: 2026-12-11',
      });
      const nights = await nightsOfRoom(roomId);
      expect(nights.map((night) => night.state)).toEqual([
        RoomNightState.Booked,
      ]);
    });

    it('answers 409 for a night held by a reservation that waits for payment', async () => {
      const roomId = await createRoom();
      await reserveNight(
        roomId,
        '2026-12-11',
        RoomNightState.Held,
        new Date(Date.now() + 10 * 60 * 1000),
      );

      const response = await block('moderator', roomId, [
        range('2026-12-11', '2026-12-12'),
      ]);

      expect(response.status).toBe(409);
    });

    it('blocks a night whose hold has expired, replacing the old hold', async () => {
      const roomId = await createRoom();
      await reserveNight(
        roomId,
        '2026-12-11',
        RoomNightState.Held,
        new Date(Date.now() - 60 * 1000),
      );

      const response = await block('moderator', roomId, [
        range('2026-12-11', '2026-12-12'),
      ]);

      expect(response.status).toBe(200);
      const nights = await nightsOfRoom(roomId);
      expect(nights.map((night) => [night.date, night.state])).toEqual([
        ['2026-12-11', RoomNightState.Blocked],
      ]);
    });

    it('answers 400 for overlapping ranges and for more than 366 nights', async () => {
      const roomId = await createRoom();

      const overlapping = await block('moderator', roomId, [
        range('2026-12-10', '2026-12-15'),
        range('2026-12-14', '2026-12-16'),
      ]);
      const tooMany = await block('moderator', roomId, [
        range('2027-01-01', '2028-01-03'),
      ]);

      expect(overlapping.status).toBe(400);
      expect(tooMany.status).toBe(400);
      expect(tooMany.body).toMatchObject({
        message: 'A request can block at most 366 nights',
      });
      expect(await nightsOfRoom(roomId)).toEqual([]);
    });

    it('answers 403 for the moderator of another hotel and 401 without login', async () => {
      const roomId = await createRoom();

      const otherModerator = await block('otherModerator', roomId, [
        range('2026-12-10', '2026-12-11'),
      ]);
      const guest = await block(undefined, roomId, [
        range('2026-12-10', '2026-12-11'),
      ]);

      expect(otherModerator.status).toBe(403);
      expect(guest.status).toBe(401);
      expect(await nightsOfRoom(roomId)).toEqual([]);
    });
  });

  describe('deactivating and reactivating', () => {
    it('deactivates a room without reservations and reactivates it', async () => {
      const roomId = await createRoom();

      const off = await deactivate('moderator', roomId);
      const offAgain = await deactivate('moderator', roomId);
      const on = await reactivate('moderator', roomId);
      const onAgain = await reactivate('moderator', roomId);

      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ id: roomId, active: false });
      expect(offAgain.status).toBe(409);
      expect(on.status).toBe(200);
      expect(on.body).toMatchObject({ active: true });
      expect(onAgain.status).toBe(409);
      expect((await rooms.findById(roomId))?.active).toBe(true);
    });

    it('answers 409 for a room with an upcoming reservation', async () => {
      const roomId = await createRoom();
      await reserveNight(roomId, todayUtc());

      const response = await deactivate('moderator', roomId);

      expect(response.status).toBe(409);
      expect((await rooms.findById(roomId))?.active).toBe(true);
    });

    it('deactivates a room whose only reservation is in the past', async () => {
      const roomId = await createRoom();
      await reserveNight(roomId, '2020-01-01');

      const response = await deactivate('moderator', roomId);

      expect(response.status).toBe(200);
    });

    it('answers 403 for a registered user', async () => {
      const roomId = await createRoom();

      const response = await deactivate('user', roomId);

      expect(response.status).toBe(403);
    });
  });

  describe('deleting (DELETE /api/hotels/:id/rooms/:roomId)', () => {
    it('deletes a room that was never reserved, with its blocks', async () => {
      const roomId = await createRoom();
      await block('moderator', roomId, [range('2026-12-10', '2026-12-12')]);

      const response = await remove('moderator', roomId);

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(await rooms.findById(roomId)).toBeNull();
      expect(await nightsOfRoom(roomId)).toEqual([]);
    });

    it('answers 409 and keeps a room that has been reserved, even in the past', async () => {
      const roomId = await createRoom();
      await reserveNight(roomId, '2020-01-01');

      const response = await remove('moderator', roomId);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        message:
          'A room that has been reserved cannot be deleted. Deactivate it instead.',
      });
      expect(await rooms.findById(roomId)).not.toBeNull();
    });

    it('answers 404 for a room of another hotel and 404 the second time', async () => {
      const foreignRoomId = await createRoom(otherHotelId);
      const roomId = await createRoom();
      await remove('moderator', roomId);

      const foreign = await remove('moderator', foreignRoomId);
      const again = await remove('moderator', roomId);

      expect(foreign.status).toBe(404);
      expect(again.status).toBe(404);
      expect(await rooms.findById(foreignRoomId)).not.toBeNull();
    });

    it('answers 403 for the moderator of another hotel and 401 without login', async () => {
      const roomId = await createRoom();

      const otherModerator = await remove('otherModerator', roomId);
      const guest = await remove(undefined, roomId);

      expect(otherModerator.status).toBe(403);
      expect(guest.status).toBe(401);
      expect(await rooms.findById(roomId)).not.toBeNull();
    });
  });

  it('lists the new routes in Swagger under the hotels tag', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');

    const paths = (
      response.body as {
        paths: Record<string, Record<string, { tags: string[] }>>;
      }
    ).paths;
    expect(paths['/api/hotels/{id}/rooms/{roomId}']?.delete?.tags).toEqual([
      'hotels',
    ]);
    expect(
      paths['/api/hotels/{id}/rooms/{roomId}/deactivate']?.patch?.tags,
    ).toEqual(['hotels']);
    expect(
      paths['/api/hotels/{id}/rooms/{roomId}/reactivate']?.patch?.tags,
    ).toEqual(['hotels']);
  });
});
