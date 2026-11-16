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
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const RUN = randomUUID().slice(0, 8);

const range = (from: string, to: string) => ({ from, to });
const DECEMBER = range('2026-12-01', '2026-12-08');

describe('Edit a room (e2e, HTL-05)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdNightIds: string[] = [];
  const cookies = new Map<string, string>();

  let hotelId: string;
  let otherHotelId: string;
  let roomId: string;
  let otherRoomId: string;

  const edit = (
    who: string | undefined,
    body: unknown,
    target: { hotel?: string; room?: string } = {},
  ) => {
    const call = request(app.getHttpServer())
      .patch(
        `/api/hotels/${target.hotel ?? hotelId}/rooms/${target.room ?? roomId}`,
      )
      .send(body as object);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  const setAvailability = (
    who: string | undefined,
    availability: unknown,
    target: { hotel?: string; room?: string } = {},
  ) => {
    const call = request(app.getHttpServer())
      .patch(
        `/api/hotels/${target.hotel ?? hotelId}/rooms/${
          target.room ?? roomId
        }/availability`,
      )
      .send({ availability } as object);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  /** A night of the managed room that a reservation holds or has booked. */
  const addNight = async (
    date: string,
    state: RoomNightState,
    holdExpiresAt?: Date,
  ): Promise<void> => {
    const night = await roomNights.create({
      roomId: new Types.ObjectId(roomId),
      hotelId: new Types.ObjectId(hotelId),
      date,
      state,
      bookingId:
        state === RoomNightState.Blocked ? undefined : new Types.ObjectId(),
      holdExpiresAt,
    });
    createdNightIds.push(night._id.toString());
  };

  const removeNights = async (): Promise<void> => {
    for (const id of createdNightIds.splice(0)) {
      await roomNights.findByIdAndDelete(id);
    }
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
    roomNights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));

    const hotel = (label: string) => ({
      name: `HTL-05 ${label} hotel ${RUN}`,
      addressLine: '12 Nile Street',
      cityId: 'htl05-test-city',
      countryCode: 'HTL05',
      description: 'A hotel created by the HTL-05 e2e test.',
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

    const room = (owner: Types.ObjectId, label: string) => ({
      hotelId: owner,
      number: `HTL05-${label}-${RUN}`,
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
    });
    const [managedRoom, otherRoom] = await rooms.insertMany([
      room(managed._id, 'A'),
      room(other._id, 'B'),
    ]);
    roomId = managedRoom._id.toString();
    otherRoomId = otherRoom._id.toString();
    createdRoomIds.push(roomId, otherRoomId);

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['moderator', Role.HotelModerator, managed._id],
      ['otherModerator', Role.HotelModerator, other._id],
      ['admin', Role.Admin, undefined],
      ['user', Role.User, undefined],
    ];
    for (const [label, role, assignedHotel] of accounts) {
      const email = `htl05-${label}-${randomUUID()}@example.com`;
      const user = await users.create({
        name: `HTL-05 ${label}`,
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

  beforeEach(async () => {
    await removeNights();
    await rooms.updateOne(
      { _id: roomId },
      {
        $set: {
          beds: 2,
          maxOccupancy: 3,
          pricePerNight: 12500,
          availability: [DECEMBER],
        },
      },
    );
  });

  afterAll(async () => {
    await removeNights();
    for (const id of createdRoomIds) {
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

  describe('PATCH /api/hotels/:id/rooms/:roomId', () => {
    it('changes the beds, occupancy and price of a room of my hotel', async () => {
      const response = await edit('moderator', {
        beds: 3,
        maxOccupancy: 4,
        pricePerNight: 15000,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: roomId,
        hotelId,
        beds: 3,
        maxOccupancy: 4,
        pricePerNight: 15000,
        currency: 'USD',
        availability: [DECEMBER],
      });
      const stored = await rooms.findById(roomId);
      expect(stored).toMatchObject({
        beds: 3,
        maxOccupancy: 4,
        pricePerNight: 15000,
      });
    });

    it('keeps the fields that were not sent', async () => {
      const response = await edit('moderator', { pricePerNight: 9900 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        beds: 2,
        maxOccupancy: 3,
        pricePerNight: 9900,
        type: 'Double',
      });
    });

    it('leaves the nights of an existing reservation as they are when the price changes', async () => {
      await addNight('2026-12-03', RoomNightState.Booked);

      const response = await edit('moderator', { pricePerNight: 20000 });

      expect(response.status).toBe(200);
      const nights = await roomNights.find({
        roomId: new Types.ObjectId(roomId),
      });
      expect(nights).toHaveLength(1);
      expect(nights[0]).toMatchObject({
        date: '2026-12-03',
        state: RoomNightState.Booked,
      });
    });

    it('rejects a price of 0, an occupancy of 0 and beds that are not whole', async () => {
      const price = await edit('moderator', { pricePerNight: 0 });
      const occupancy = await edit('moderator', { maxOccupancy: 0 });
      const beds = await edit('moderator', { beds: 1.5 });

      expect(price.status).toBe(400);
      expect(price.body).toMatchObject({
        message: 'Validation failed',
        errors: [
          {
            field: 'pricePerNight',
            messages: ['pricePerNight must be more than 0'],
          },
        ],
      });
      expect(occupancy.status).toBe(400);
      expect(beds.status).toBe(400);
    });

    it('rejects null, an empty body and a field that cannot be changed here', async () => {
      const nullValue = await edit('moderator', { beds: null });
      const empty = await edit('moderator', {});
      const number = await edit('moderator', { number: '999' });
      const active = await edit('moderator', { beds: 2, active: false });
      const hotel = await edit('moderator', { beds: 2, hotelId: otherHotelId });

      for (const response of [nullValue, empty, number, active, hotel]) {
        expect(response.status).toBe(400);
      }
      expect(empty.body).toMatchObject({
        message: 'Send at least one of beds, maxOccupancy or pricePerNight',
      });
      const stored = await rooms.findById(roomId);
      expect(stored).toMatchObject({ beds: 2, active: true });
    });

    it('answers 403 for the moderator of another hotel and changes nothing', async () => {
      const response = await edit('otherModerator', { pricePerNight: 1 });

      expect(response.status).toBe(403);
      const stored = await rooms.findById(roomId);
      expect(stored?.pricePerNight).toBe(12500);
    });

    it('answers 404 for a room of another hotel reached through my hotel', async () => {
      const response = await edit(
        'moderator',
        { pricePerNight: 1 },
        { room: otherRoomId },
      );

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ message: 'Room not found' });
      const stored = await rooms.findById(otherRoomId);
      expect(stored?.pricePerNight).toBe(12500);
    });

    it('answers 403 for an admin and a registered user, and 401 without login', async () => {
      const admin = await edit('admin', { beds: 3 });
      const user = await edit('user', { beds: 3 });
      const guest = await edit(undefined, { beds: 3 });

      expect(admin.status).toBe(403);
      expect(user.status).toBe(403);
      expect(guest.status).toBe(401);
    });

    it('answers 404 for a missing room or hotel and 400 for a bad id', async () => {
      const missingRoom = await edit(
        'moderator',
        { beds: 3 },
        { room: new Types.ObjectId().toString() },
      );
      const missingHotel = await edit(
        'moderator',
        { beds: 3 },
        { hotel: new Types.ObjectId().toString() },
      );
      const badId = await edit('moderator', { beds: 3 }, { room: 'abc' });

      expect(missingRoom.status).toBe(404);
      expect(missingHotel.status).toBe(404);
      expect(badId.status).toBe(400);
    });
  });

  describe('PATCH /api/hotels/:id/rooms/:roomId/availability', () => {
    it('replaces the ranges and returns them ordered by first night', async () => {
      const response = await setAvailability('moderator', [
        range('2026-12-20', '2027-01-05'),
        range('2026-12-01', '2026-12-05'),
      ]);

      expect(response.status).toBe(200);
      const expected = [
        range('2026-12-01', '2026-12-05'),
        range('2026-12-20', '2027-01-05'),
      ];
      expect((response.body as { availability: unknown }).availability).toEqual(
        expected,
      );
      const stored = await rooms.findById(roomId);
      expect(
        stored?.availability.map(({ from, to }) => ({ from, to })),
      ).toEqual(expected);
    });

    it('removes all availability with an empty list when nothing is reserved', async () => {
      const response = await setAvailability('moderator', []);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ availability: [] });
    });

    it('accepts ranges that only touch', async () => {
      const response = await setAvailability('moderator', [
        range('2026-12-01', '2026-12-08'),
        range('2026-12-08', '2026-12-12'),
      ]);

      expect(response.status).toBe(200);
    });

    it('answers 400 for ranges that overlap and keeps the old ranges', async () => {
      const response = await setAvailability('moderator', [
        range('2026-12-01', '2026-12-08'),
        range('2026-12-07', '2026-12-12'),
      ]);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message:
          'Availability ranges must not overlap: 2026-12-01 to 2026-12-08 and 2026-12-07 to 2026-12-12',
      });
      const stored = await rooms.findById(roomId);
      expect(stored?.availability).toHaveLength(1);
    });

    it('answers 400 for a bad date, a reversed range and a missing list', async () => {
      const badDate = await setAvailability('moderator', [
        range('2026-02-30', '2026-03-05'),
      ]);
      const reversed = await setAvailability('moderator', [
        range('2026-12-08', '2026-12-01'),
      ]);
      const notAList = await setAvailability('moderator', 'always');
      const missing = await request(app.getHttpServer())
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', cookies.get('moderator') ?? '')
        .send({});

      for (const response of [badDate, reversed, notAList, missing]) {
        expect(response.status).toBe(400);
      }
      expect(reversed.body).toMatchObject({
        errors: [
          {
            field: 'availability.0.from',
            messages: ['from must be earlier than to'],
          },
        ],
      });
    });

    it('answers 409 when a night of a confirmed reservation would be left out', async () => {
      await addNight('2026-12-03', RoomNightState.Booked);
      await addNight('2026-12-04', RoomNightState.Booked);

      const response = await setAvailability('moderator', [
        range('2026-12-01', '2026-12-04'),
      ]);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        message:
          'Availability cannot be removed for nights with a reservation: 2026-12-04',
      });
      const stored = await rooms.findById(roomId);
      expect(
        stored?.availability.map(({ from, to }) => ({ from, to })),
      ).toEqual([DECEMBER]);
    });

    it('allows a change that keeps every reserved night inside the ranges', async () => {
      await addNight('2026-12-03', RoomNightState.Booked);
      await addNight('2026-12-04', RoomNightState.Booked);

      const response = await setAvailability('moderator', [
        range('2026-12-03', '2026-12-05'),
      ]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        availability: [range('2026-12-03', '2026-12-05')],
      });
    });

    it('answers 409 for a night held by a reservation that waits for payment', async () => {
      await addNight(
        '2026-12-05',
        RoomNightState.Held,
        new Date(Date.now() + 10 * 60 * 1000),
      );

      const response = await setAvailability('moderator', []);

      expect(response.status).toBe(409);
    });

    it('ignores a hold that has expired and a night the moderator blocked', async () => {
      await addNight(
        '2026-12-05',
        RoomNightState.Held,
        new Date(Date.now() - 60 * 1000),
      );
      await addNight('2026-12-06', RoomNightState.Blocked);

      const response = await setAvailability('moderator', []);

      expect(response.status).toBe(200);
    });

    it('answers 403 for the moderator of another hotel and 404 for a room of another hotel', async () => {
      const otherModerator = await setAvailability('otherModerator', []);
      const foreignRoom = await setAvailability('moderator', [], {
        room: otherRoomId,
      });

      expect(otherModerator.status).toBe(403);
      expect(foreignRoom.status).toBe(404);
      const stored = await rooms.findById(roomId);
      expect(stored?.availability).toHaveLength(1);
    });

    it('answers 403 for an admin and a registered user, and 401 without login', async () => {
      const admin = await setAvailability('admin', []);
      const user = await setAvailability('user', []);
      const guest = await setAvailability(undefined, []);

      expect(admin.status).toBe(403);
      expect(user.status).toBe(403);
      expect(guest.status).toBe(401);
    });
  });

  it('lists both routes in Swagger under the hotels tag', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');

    const paths = (
      response.body as {
        paths: Record<string, { patch?: { tags: string[] } }>;
      }
    ).paths;
    expect(paths['/api/hotels/{id}/rooms/{roomId}']?.patch?.tags).toEqual([
      'hotels',
    ]);
    expect(
      paths['/api/hotels/{id}/rooms/{roomId}/availability']?.patch?.tags,
    ).toEqual(['hotels']);
  });
});
