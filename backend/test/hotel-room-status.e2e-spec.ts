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

describe('Room status for a date range (e2e, HTL-08)', () => {
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
  let roomA: string;
  let roomB: string;
  const bookingId = new Types.ObjectId().toString();
  const heldBookingId = new Types.ObjectId().toString();

  const status = (
    who: string | undefined,
    query: Record<string, string>,
    hotel = () => hotelId,
  ) => {
    const call = request(app.getHttpServer())
      .get(`/api/hotels/${hotel()}/availability`)
      .query(query);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  const createRoom = async (
    owner: string,
    number: string,
    fields: Partial<Room> = {},
  ): Promise<string> => {
    const room = await rooms.create({
      hotelId: new Types.ObjectId(owner),
      number,
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      availability: [range('2026-12-01', '2026-12-20')],
      ...fields,
    });
    const id = room._id.toString();
    createdRoomIds.push(id);
    return id;
  };

  const night = (
    roomId: string,
    date: string,
    state: RoomNightState,
    extra: Partial<RoomNight> = {},
  ) => ({
    roomId: new Types.ObjectId(roomId),
    hotelId: new Types.ObjectId(hotelId),
    date,
    state,
    ...extra,
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
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = app.get<Model<Room>>(getModelToken(Room.name));
    roomNights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    await roomNights.init();

    const hotel = (label: string) => ({
      name: `HTL-08 ${label} hotel ${RUN}`,
      addressLine: '12 Nile Street',
      cityId: 'htl08-test-city',
      countryCode: 'HTL08',
      description: 'A hotel created by the HTL-08 e2e test.',
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

    roomA = await createRoom(hotelId, '101');
    roomB = await createRoom(hotelId, '102', {
      active: false,
      availability: [range('2026-12-03', '2026-12-05')],
    });
    await createRoom(otherHotelId, '101');

    await roomNights.insertMany([
      night(roomA, '2026-12-02', RoomNightState.Booked, {
        bookingId: new Types.ObjectId(bookingId),
      }),
      night(roomA, '2026-12-03', RoomNightState.Booked, {
        bookingId: new Types.ObjectId(bookingId),
      }),
      night(roomA, '2026-12-04', RoomNightState.Blocked),
      night(roomA, '2026-12-05', RoomNightState.Held, {
        bookingId: new Types.ObjectId(heldBookingId),
        holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
      // A hold whose time has passed no longer counts.
      night(roomA, '2026-12-06', RoomNightState.Held, {
        bookingId: new Types.ObjectId(),
        holdExpiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ]);

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role, Types.ObjectId | undefined][] = [
      ['moderator', Role.HotelModerator, managed._id],
      ['otherModerator', Role.HotelModerator, other._id],
      ['user', Role.User, undefined],
    ];
    for (const [label, role, assignedHotel] of accounts) {
      const email = `htl08-${label}-${randomUUID()}@example.com`;
      const user = await users.create({
        name: `HTL-08 ${label}`,
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

  it('shows every room of the hotel with the status of each night', async () => {
    const response = await status('moderator', {
      from: '2026-11-30',
      to: '2026-12-08',
    });

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(response.body.items).toEqual([
      {
        id: roomA,
        number: '101',
        type: 'Double',
        active: true,
        segments: [
          { from: '2026-11-30', to: '2026-12-01', status: 'unavailable' },
          { from: '2026-12-01', to: '2026-12-02', status: 'available' },
          {
            from: '2026-12-02',
            to: '2026-12-04',
            status: 'booked',
            bookingId,
            pendingPayment: false,
          },
          { from: '2026-12-04', to: '2026-12-05', status: 'blocked' },
          {
            from: '2026-12-05',
            to: '2026-12-06',
            status: 'booked',
            bookingId: heldBookingId,
            pendingPayment: true,
          },
          { from: '2026-12-06', to: '2026-12-08', status: 'available' },
        ],
      },
      {
        id: roomB,
        number: '102',
        type: 'Double',
        active: false,
        segments: [
          { from: '2026-11-30', to: '2026-12-03', status: 'unavailable' },
          { from: '2026-12-03', to: '2026-12-05', status: 'available' },
          { from: '2026-12-05', to: '2026-12-08', status: 'unavailable' },
        ],
      },
    ]);
  });

  it('pages through the rooms', async () => {
    const response = await status('moderator', {
      from: '2026-12-01',
      to: '2026-12-02',
      page: '2',
      limit: '1',
    });

    expect(response.status).toBe(200);
    expect(response.body.items.map((room: { id: string }) => room.id)).toEqual([
      roomB,
    ]);
    expect(response.body.meta).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('sorts room numbers with their digits compared as numbers: 2, 9, 10', async () => {
    // Created in this order so that the order they were stored in is not
    // the answer. As plain text the order would be 10, 101, 2, 9. They go
    // to the other hotel, so the tests on the managed hotel keep their rooms;
    // afterAll deletes them by id.
    for (const number of ['10', '2', '9']) {
      await createRoom(otherHotelId, number);
    }

    const response = await status(
      'otherModerator',
      { from: '2026-12-01', to: '2026-12-02' },
      () => otherHotelId,
    );

    expect(response.status).toBe(200);
    expect(
      response.body.items.map((room: { number: string }) => room.number),
    ).toEqual(['2', '9', '10', '101']);
  });

  it.each([
    [{}],
    [{ from: '2026-12-01' }],
    [{ from: '2026-12-05', to: '2026-12-01' }],
    [{ from: '2026-13-01', to: '2026-13-05' }],
    [{ from: '2026-01-01', to: '2027-01-03' }],
    [{ from: '2026-12-01', to: '2026-12-05', extra: 'x' }],
  ])('answers 400 for %j', async (query) => {
    const response = await status('moderator', query);
    expect(response.status).toBe(400);
  });

  it('answers 400 for a hotel id that is not an id', async () => {
    const response = await status(
      'moderator',
      { from: '2026-12-01', to: '2026-12-05' },
      () => 'not-an-id',
    );
    expect(response.status).toBe(400);
  });

  it('answers 401 to a guest', async () => {
    const response = await status(undefined, {
      from: '2026-12-01',
      to: '2026-12-05',
    });
    expect(response.status).toBe(401);
  });

  it('answers 403 to a registered user', async () => {
    const response = await status('user', {
      from: '2026-12-01',
      to: '2026-12-05',
    });
    expect(response.status).toBe(403);
  });

  it('answers 403 to the moderator of another hotel', async () => {
    const response = await status('otherModerator', {
      from: '2026-12-01',
      to: '2026-12-05',
    });
    expect(response.status).toBe(403);
  });

  it('answers 404 for a hotel that does not exist', async () => {
    const response = await status(
      'moderator',
      { from: '2026-12-01', to: '2026-12-05' },
      () => new Types.ObjectId().toString(),
    );
    expect(response.status).toBe(404);
  });
});
