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
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';
const TIMES = {
  checkInTime: '14:00',
  checkOutTime: '12:00',
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ],
};

describe('PUT /api/hotels/:id/policies (e2e, HTL-09, HTL-10)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let passwordHash: string;

  // Everything this file creates is deleted again, one record at a time.
  const createdUserIds: string[] = [];
  const createdHotelIds: string[] = [];

  const createHotel = async (): Promise<string> => {
    const hotel = await hotels.create({
      name: 'HTL-09 Test Hotel',
      addressLine: '12 Nile Street',
      cityId: 'city_001',
      countryCode: 'EG',
      description: 'A quiet hotel close to the city centre.',
      starClass: 4,
      amenities: ['wifi'],
    });
    const id = hotel._id.toString();
    createdHotelIds.push(id);
    return id;
  };

  /** Creates an account and logs it in. A moderator gets `hotelId` assigned. */
  const loginAsNew = async (role: Role, hotelId?: string): Promise<string> => {
    const email = `htl09-${randomUUID()}@example.com`;
    const user = await users.create({
      name: 'HTL-09 Test User',
      email,
      passwordHash,
      role,
      status: UserStatus.Active,
      consentAcceptedAt: new Date(),
      assignment: hotelId
        ? {
            providerType: ProviderType.Hotel,
            providerId: new Types.ObjectId(hotelId),
          }
        : undefined,
    });
    createdUserIds.push(user._id.toString());

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    expect(response.status).toBe(200);

    const header = response.headers['set-cookie'] as unknown as string[];
    const accessCookie = header
      .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`))
      ?.split(';')[0];
    expect(accessCookie).toBeDefined();
    return accessCookie!;
  };

  const setPolicies = (hotelId: string, body: unknown, cookie?: string) => {
    const call = request(app.getHttpServer())
      .put(`/api/hotels/${hotelId}/policies`)
      .send(body as object);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  let hotelId: string;
  let moderatorCookie: string;

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD, 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));

    hotelId = await createHotel();
    moderatorCookie = await loginAsNew(Role.HotelModerator, hotelId);
  });

  afterAll(async () => {
    for (const id of createdHotelIds) {
      await hotels.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  it('sets the check-in and check-out times of my hotel', async () => {
    const response = await setPolicies(hotelId, TIMES, moderatorCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(TIMES);
    const stored = await hotels.findById(hotelId);
    expect(stored?.policy).toMatchObject(TIMES);
  });

  it('shows the times on the public hotel page', async () => {
    await setPolicies(hotelId, TIMES, moderatorCookie);

    const page = await request(app.getHttpServer()).get(
      `/api/hotels/${hotelId}`,
    );

    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ id: hotelId, policy: TIMES });
  });

  it('replaces the times that were set before', async () => {
    await setPolicies(hotelId, TIMES, moderatorCookie);

    const response = await setPolicies(
      hotelId,
      { checkInTime: '15:30', checkOutTime: '11:00', cancellationTiers: [] },
      moderatorCookie,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      checkInTime: '15:30',
      checkOutTime: '11:00',
      cancellationTiers: [],
    });
  });

  it('leaves the hotel profile unchanged', async () => {
    await setPolicies(hotelId, TIMES, moderatorCookie);

    const stored = await hotels.findById(hotelId);

    expect(stored).toMatchObject({
      name: 'HTL-09 Test Hotel',
      starClass: 4,
      active: true,
    });
  });

  it('rejects a time that is not HH:mm on the 24-hour clock', async () => {
    const response = await setPolicies(
      hotelId,
      { ...TIMES, checkInTime: '2pm', checkOutTime: '24:00' },
      moderatorCookie,
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      message: 'Validation failed',
      errors: [
        {
          field: 'checkInTime',
          messages: [
            'checkInTime must be a time such as 14:00 (HH:mm, 24-hour clock)',
          ],
        },
        {
          field: 'checkOutTime',
          messages: [
            'checkOutTime must be a time such as 12:00 (HH:mm, 24-hour clock)',
          ],
        },
      ],
    });
  });

  it('rejects a missing time and a field that is not allowed', async () => {
    const missing = await setPolicies(
      hotelId,
      { checkInTime: '14:00', cancellationTiers: [] },
      moderatorCookie,
    );
    const extra = await setPolicies(
      hotelId,
      { ...TIMES, active: false },
      moderatorCookie,
    );

    expect(missing.status).toBe(400);
    expect(extra.status).toBe(400);
  });

  it('answers 403 for the moderator of another hotel and changes nothing', async () => {
    const otherHotelId = await createHotel();
    const otherModeratorCookie = await loginAsNew(
      Role.HotelModerator,
      otherHotelId,
    );
    await setPolicies(hotelId, TIMES, moderatorCookie);

    const response = await setPolicies(
      hotelId,
      { checkInTime: '01:00', checkOutTime: '02:00', cancellationTiers: [] },
      otherModeratorCookie,
    );

    expect(response.status).toBe(403);
    const stored = await hotels.findById(hotelId);
    expect(stored?.policy).toMatchObject(TIMES);
  });

  it('stores the tiers with the highest threshold first (HTL-10)', async () => {
    const response = await setPolicies(
      hotelId,
      {
        ...TIMES,
        cancellationTiers: [
          { daysBefore: 0, refundPercent: 0 },
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
        ],
      },
      moderatorCookie,
    );

    expect(response.status).toBe(200);
    expect(
      (response.body as { cancellationTiers: unknown[] }).cancellationTiers,
    ).toEqual([
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ]);
  });

  it('accepts an empty tier list, which means no refund (HTL-10)', async () => {
    const response = await setPolicies(
      hotelId,
      { ...TIMES, cancellationTiers: [] },
      moderatorCookie,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cancellationTiers: [] });
  });

  it('rejects two tiers with the same threshold (HTL-10)', async () => {
    const response = await setPolicies(
      hotelId,
      {
        ...TIMES,
        cancellationTiers: [
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 7, refundPercent: 80 },
        ],
      },
      moderatorCookie,
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      errors: [
        {
          field: 'cancellationTiers',
          messages: ['Each cancellation tier must have a different daysBefore'],
        },
      ],
    });
  });

  it('rejects a tier outside the limits and a missing tier list (HTL-10)', async () => {
    const send = (cancellationTiers: unknown) =>
      setPolicies(hotelId, { ...TIMES, cancellationTiers }, moderatorCookie);

    const negativeDays = await send([{ daysBefore: -1, refundPercent: 50 }]);
    const fractionDays = await send([{ daysBefore: 1.5, refundPercent: 50 }]);
    const tooMuch = await send([{ daysBefore: 7, refundPercent: 101 }]);
    const extraField = await send([
      { daysBefore: 7, refundPercent: 50, note: 'x' },
    ]);
    const missing = await setPolicies(
      hotelId,
      { checkInTime: '14:00', checkOutTime: '12:00' },
      moderatorCookie,
    );

    for (const response of [
      negativeDays,
      fractionDays,
      tooMuch,
      extraField,
      missing,
    ]) {
      expect(response.status).toBe(400);
    }
    expect(tooMuch.body).toMatchObject({
      errors: [
        {
          field: 'cancellationTiers.0.refundPercent',
          messages: ['refundPercent must be between 0 and 100'],
        },
      ],
    });
  });

  it('answers 403 for a registered user and for an admin', async () => {
    const userCookie = await loginAsNew(Role.User);
    const adminCookie = await loginAsNew(Role.Admin);

    const asUser = await setPolicies(hotelId, TIMES, userCookie);
    const asAdmin = await setPolicies(hotelId, TIMES, adminCookie);

    expect(asUser.status).toBe(403);
    expect(asAdmin.status).toBe(403);
  });

  it('answers 401 without login', async () => {
    const response = await setPolicies(hotelId, TIMES);

    expect(response.status).toBe(401);
  });

  it('answers 404 for a hotel that does not exist and 400 for a bad id', async () => {
    const missing = await setPolicies(
      new Types.ObjectId().toString(),
      TIMES,
      moderatorCookie,
    );
    const badId = await setPolicies('not-an-id', TIMES, moderatorCookie);

    expect(missing.status).toBe(404);
    expect(badId.status).toBe(400);
  });
});
