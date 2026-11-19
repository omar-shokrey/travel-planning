import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { RoomNightState } from './../src/hotels/models/room-night-state.enum';
import { RoomNight } from './../src/hotels/models/room-night.schema';
import { Room } from './../src/hotels/models/room.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  createItineraryFixture,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';
import { sessionCookieFor } from './support/session-cookie';

const RUN = randomUUID().slice(0, 8);

/** Dates far in the future, so "check-in in the past" never trips. */
const OPEN = { from: '2099-03-01', to: '2099-04-01' };
/** The start of the itinerary: day 1 is 10 March, day 4 is 13 March. */
const START = '2099-03-10';

interface HotelBody {
  id: string;
  name: string;
  cityId: string;
  freeRooms: number;
  lowestPricePerNight: number;
  currency: string;
  checkIn: string;
  checkOut: string;
}
interface PageBody {
  items: HotelBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
interface SwaggerOperation {
  tags: string[];
  description: string;
  responses: Record<string, unknown>;
}

describe('Hotels for a city group (e2e, ITN-25)', () => {
  let fixture: ItineraryFixture;
  let owner: FixtureUser;
  let other: FixtureUser;
  let A: string;
  let B: string;
  /** Days 1-2 in A, day 3 in B, day 4 in A again; starts on 2099-03-10. */
  let itineraryId: string;

  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let roomNights: Model<RoomNight>;

  // Everything this file creates is deleted again, one record at a time.
  const createdHotelIds: string[] = [];
  const createdRoomIds: string[] = [];
  const staff: { id: string; role: Role; cookie: string }[] = [];

  const hotelsOf = (id: string, query: Record<string, string | number>) =>
    fixture
      .http()
      .get(`/api/itineraries/${id}/hotels`)
      .set('Cookie', owner.cookie)
      .query(query);
  const group = (
    firstDayNumber: number,
    extra: Record<string, string | number> = {},
  ) => hotelsOf(itineraryId, { firstDayNumber, guests: 2, ...extra });
  const names = (body: PageBody) => body.items.map((item) => item.name);
  /** The hotel names of a group for these guests and rooms (200 expected). */
  const namesFor = async (
    firstDayNumber: number,
    extra: Record<string, string | number> = {},
  ): Promise<string[]> =>
    names((await group(firstDayNumber, extra).expect(200)).body as PageBody);

  const createHotel = async (
    label: string,
    cityId: string,
    fields: Partial<Hotel> = {},
  ): Promise<string> => {
    const hotel = await hotels.create({
      name: `${label} ${RUN}`,
      addressLine: '1 Test Street',
      cityId,
      countryCode: fixture.country,
      description: 'A hotel created by the ITN-25 e2e test.',
      photos: [],
      starClass: 3,
      amenities: [],
      ...fields,
    });
    const id = hotel._id.toString();
    createdHotelIds.push(id);
    return id;
  };

  const createRoom = async (
    hotelId: string,
    number: string,
    fields: Partial<Room> = {},
  ): Promise<string> => {
    const room = await rooms.create({
      hotelId: new Types.ObjectId(hotelId),
      number,
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNight: 10000,
      availability: [OPEN],
      ...fields,
    });
    const id = room._id.toString();
    createdRoomIds.push(id);
    return id;
  };

  const takeNight = (
    hotelId: string,
    roomId: string,
    date: string,
    state: RoomNightState,
    extra: Partial<RoomNight> = {},
  ) =>
    roomNights.create({
      roomId: new Types.ObjectId(roomId),
      hotelId: new Types.ObjectId(hotelId),
      date,
      state,
      ...extra,
    });

  /** A user made straight in the database, with a session (ACC-06). */
  const createStaff = async (role: Role): Promise<string> => {
    const user = await users.create({
      name: `ITN-25 ${role}`,
      email: `itn25-${role}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      }),
    });
    const id = user._id.toString();
    const cookie = await sessionCookieFor(fixture.app, id);
    staff.push({ id, role, cookie });
    return cookie;
  };

  /** A new itinerary of `user` that starts on `startDate`, one day per city. */
  const itineraryStarting = async (
    startDate: string,
    cities: string[],
    user: FixtureUser = owner,
  ) => {
    const created = await fixture.createItinerary(user, cities);
    await fixture
      .http()
      .patch(`/api/itineraries/${created.id}`)
      .set('Cookie', user.cookie)
      .send({ startDate })
      .expect(200);
    return created;
  };

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    users = fixture.app.get<Model<User>>(getModelToken(User.name));
    hotels = fixture.app.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = fixture.app.get<Model<Room>>(getModelToken(Room.name));
    roomNights = fixture.app.get<Model<RoomNight>>(
      getModelToken(RoomNight.name),
    );
    await roomNights.init();
    owner = await fixture.createUser();
    other = await fixture.createUser();
    A = fixture.cityA;
    B = fixture.cityB;
    itineraryId = (await itineraryStarting(START, [A, A, B, A])).id;

    // Alpha: two free rooms, for 2 and 3 guests.
    const alpha = await createHotel('Alpha', A);
    await createRoom(alpha, '101', { maxOccupancy: 2, pricePerNight: 9000 });
    await createRoom(alpha, '102', { maxOccupancy: 3, pricePerNight: 15000 });

    // Bravo: blocked on 11 March, the second night of the first group.
    const bravo = await createHotel('Bravo', A);
    const bravoRoom = await createRoom(bravo, '1', { maxOccupancy: 4 });
    await takeNight(bravo, bravoRoom, '2099-03-11', RoomNightState.Blocked);

    // Charlie: free, but the hotel is deactivated (ACC-15).
    const charlie = await createHotel('Charlie', A, { active: false });
    await createRoom(charlie, '1');

    // Delta: bookable only until 10 March, so no night after it.
    const delta = await createHotel('Delta', A);
    await createRoom(delta, '1', {
      availability: [{ from: '2099-03-01', to: '2099-03-11' }],
    });

    // Echo: held on 13 March, the night of the last group, by a live hold.
    const echo = await createHotel('Echo', A);
    const echoRoom = await createRoom(echo, '1');
    await takeNight(echo, echoRoom, '2099-03-13', RoomNightState.Held, {
      bookingId: new Types.ObjectId(),
      holdExpiresAt: new Date('2099-03-13T00:10:00.000Z'),
    });

    // Luxor Inn: the one hotel of the second city.
    const luxor = await createHotel('Luxor Inn', B);
    await createRoom(luxor, '1', { pricePerNight: 7000 });

    await createStaff(Role.Admin);
    await createStaff(Role.HotelModerator);
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await roomNights.deleteMany({ roomId: new Types.ObjectId(id) });
      await rooms.deleteOne({ _id: id });
    }
    for (const id of createdHotelIds) {
      await hotels.deleteOne({ _id: id });
    }
    for (const { id } of staff) {
      await deleteSessionsOf(fixture.app, id);
      await users.deleteOne({ _id: id });
    }
    await fixture.cleanup();
  });

  describe('the group gives the city and the dates', () => {
    it('lists the hotels of the first group for 10 to 12 March, by name, with the searched stay', async () => {
      const response = await group(1).expect(200);
      const body = response.body as PageBody;

      // Bravo is blocked on the 11th, Charlie is deactivated and Delta stops
      // on the 10th. Echo is held only on the 13th.
      expect(names(body)).toEqual([`Alpha ${RUN}`, `Echo ${RUN}`]);
      expect(body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(body.items[0]).toMatchObject({
        cityId: A,
        freeRooms: 2,
        lowestPricePerNight: 9000,
        currency: 'USD',
        checkIn: '2099-03-10',
        checkOut: '2099-03-12',
      });
      expect(body.items.every((item) => item.checkIn === '2099-03-10')).toBe(
        true,
      );
      expect(body.items.every((item) => item.checkOut === '2099-03-12')).toBe(
        true,
      );
    });

    it('lists the hotels of the second city for its one day: 12 to 13 March', async () => {
      const body = (await group(3).expect(200)).body as PageBody;

      expect(names(body)).toEqual([`Luxor Inn ${RUN}`]);
      expect(body.items[0]).toMatchObject({
        cityId: B,
        lowestPricePerNight: 7000,
        checkIn: '2099-03-12',
        checkOut: '2099-03-13',
      });
    });

    it('lists a city that is visited again by its own dates: 13 to 14 March', async () => {
      const body = (await group(4).expect(200)).body as PageBody;

      // Bravo is no longer blocked on the 13th; Echo is held on that night.
      expect(names(body)).toEqual([`Alpha ${RUN}`, `Bravo ${RUN}`]);
      expect(body.items.map((item) => [item.checkIn, item.checkOut])).toEqual([
        ['2099-03-13', '2099-03-14'],
        ['2099-03-13', '2099-03-14'],
      ]);
    });

    it('follows the itinerary: deleting a day shortens the stay of the group', async () => {
      const itinerary = await itineraryStarting(START, [A, A]);
      const before = (
        await hotelsOf(itinerary.id, { firstDayNumber: 1, guests: 2 }).expect(
          200,
        )
      ).body as PageBody;
      await fixture
        .http()
        .delete(`/api/itineraries/${itinerary.id}/days/${itinerary.days[1].id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      const after = (
        await hotelsOf(itinerary.id, { firstDayNumber: 1, guests: 2 }).expect(
          200,
        )
      ).body as PageBody;

      expect(before.items[0].checkOut).toBe('2099-03-12');
      expect(after.items[0].checkOut).toBe('2099-03-11');
      // One night, the 10th: Bravo (blocked on the 11th) and Delta (bookable
      // until the 10th) are free for it as well.
      expect(names(after)).toEqual([
        `Alpha ${RUN}`,
        `Bravo ${RUN}`,
        `Delta ${RUN}`,
        `Echo ${RUN}`,
      ]);
    });
  });

  describe('reusing hotel search (HTL-11)', () => {
    it('gives the same hotels, free rooms and prices as hotel search for the same city and dates', async () => {
      const viaItinerary = (await group(1).expect(200)).body as PageBody;
      const search = await fixture
        .http()
        .get('/api/hotels/search')
        .query({
          cityId: A,
          checkIn: '2099-03-10',
          checkOut: '2099-03-12',
          guests: 2,
        })
        .expect(200);
      const viaSearch = search.body as PageBody;

      expect(
        viaItinerary.items.map(
          ({ checkIn: _in, checkOut: _out, ...hotel }) => hotel,
        ),
      ).toEqual(viaSearch.items);
      expect(viaItinerary.meta).toEqual(viaSearch.meta);
    });

    it('applies the guests and the rooms that the user enters', async () => {
      // Alpha has rooms for 2 and 3 guests; Echo has one room for 2.
      expect(await namesFor(1, { guests: 3 })).toEqual([`Alpha ${RUN}`]);
      expect(await namesFor(1, { guests: 5, rooms: 2 })).toEqual([
        `Alpha ${RUN}`,
      ]);
      expect(await namesFor(1, { guests: 6, rooms: 2 })).toEqual([]);
      expect(await namesFor(1, { guests: 2, rooms: 3 })).toEqual([]);
    });

    it('answers an empty page, not an error, when no hotel can take the search', async () => {
      const response = await group(1, { guests: 100, rooms: 20 }).expect(200);

      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('pages the results', async () => {
      const second = (await group(4, { page: 2, limit: 1 }).expect(200))
        .body as PageBody;

      expect(names(second)).toEqual([`Bravo ${RUN}`]);
      expect(second.meta).toEqual({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
    });

    it('only reads: the nights of the rooms are the same after the searches', async () => {
      const count = () =>
        roomNights.countDocuments({
          roomId: { $in: createdRoomIds.map((id) => new Types.ObjectId(id)) },
        });
      const before = await count();

      await group(1).expect(200);
      await group(4).expect(200);

      expect(await count()).toBe(before);
    });
  });

  describe('the owner picks the group', () => {
    it('answers 404 for a day that does not start a city group', async () => {
      for (const day of [2, 5, 60]) {
        const response = await group(day).expect(404);

        expect(response.body).toMatchObject({
          statusCode: 404,
          message: 'City group not found',
        });
      }
    });

    it('answers 404 for an itinerary without days', async () => {
      const empty = await itineraryStarting(START, []);

      await hotelsOf(empty.id, { firstDayNumber: 1, guests: 2 }).expect(404);
    });

    it('answers 400 for a group that starts in the past, naming firstDayNumber', async () => {
      const past = await itineraryStarting('2020-01-01', [A]);

      const response = await hotelsOf(past.id, {
        firstDayNumber: 1,
        guests: 2,
      }).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
        errors: [{ field: 'firstDayNumber' }],
      });
    });

    const badQueries: [string, Record<string, string | number>, string][] = [
      ['no firstDayNumber', { guests: 2 }, 'firstDayNumber'],
      ['firstDayNumber 0', { firstDayNumber: 0, guests: 2 }, 'firstDayNumber'],
      ['no guests', { firstDayNumber: 1 }, 'guests'],
      ['0 guests', { firstDayNumber: 1, guests: 0 }, 'guests'],
      ['0 rooms', { firstDayNumber: 1, guests: 2, rooms: 0 }, 'rooms'],
      [
        'a check-in date: the dates come from the group',
        { firstDayNumber: 1, guests: 2, checkIn: '2099-03-10' },
        'checkIn',
      ],
      [
        'a city: the city comes from the group',
        { firstDayNumber: 1, guests: 2, cityId: 'cairo' },
        'cityId',
      ],
    ];
    it.each(badQueries)('answers 400 for %s', async (_label, query, field) => {
      const response = await hotelsOf(itineraryId, query).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
        errors: [{ field }],
      });
    });

    it('answers 400 for an id that is not an id, and 404 for an itinerary that does not exist', async () => {
      await hotelsOf('not-an-id', { firstDayNumber: 1, guests: 2 }).expect(400);
      await hotelsOf(new Types.ObjectId().toString(), {
        firstDayNumber: 1,
        guests: 2,
      }).expect(404);
    });
  });

  describe('who may ask', () => {
    const asked = (cookie: string) => {
      const call = fixture
        .http()
        .get(`/api/itineraries/${itineraryId}/hotels`)
        .query({ firstDayNumber: 1, guests: 2 });
      return cookie ? call.set('Cookie', cookie) : call;
    };
    const cookieOf = (role: Role): string => {
      const user = staff.find((candidate) => candidate.role === role);
      if (!user) throw new Error(`No ${role} was created`);
      return user.cookie;
    };

    it('answers 401 to a guest', async () => {
      const response = await asked('').expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        path: `/api/itineraries/${itineraryId}/hotels`,
      });
    });

    it('answers 403 to another user: the itinerary is private to its owner', async () => {
      await asked(other.cookie).expect(403);
    });

    it('answers 403 to an administrator and to a hotel moderator', async () => {
      await asked(cookieOf(Role.Admin)).expect(403);
      await asked(cookieOf(Role.HotelModerator)).expect(403);
    });

    it('lets the owner search a private itinerary', async () => {
      await asked(owner.cookie).expect(200);
    });
  });

  it('documents the route in Swagger', async () => {
    const response = await fixture.http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const operation = paths['/api/itineraries/{id}/hotels'].get;

    expect(operation.tags).toEqual(['Itineraries']);
    expect(operation.description).toMatch(/^ITN-25\. /);
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );
  });
});
