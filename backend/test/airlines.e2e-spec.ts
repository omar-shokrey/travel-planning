import './support/auth-env';
import './support/uploads-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Airline } from './../src/flights/models/airline.schema';
import { UploadsService } from './../src/uploads/uploads.service';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const uniqueEmail = (): string => `flt01-${randomUUID()}@example.com`;
const uniqueCode = (): string =>
  `T${randomUUID().replaceAll('-', '').slice(0, 9).toUpperCase()}`;
const png = (content = 'airline logo'): Buffer =>
  Buffer.concat([PNG_SIGNATURE, Buffer.from(content)]);

interface TestUser {
  id: string;
  email: string;
}

interface AirlineResponseBody {
  id: string;
  name: string;
  code: string;
  logo: string;
  logoUrl: string;
  active: boolean;
}

/** The `Set-Cookie` lines of a response. */
function setCookieLines(response: {
  headers: Record<string, unknown>;
}): string[] {
  const header = response.headers['set-cookie'];
  return Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
}

function cookieValue(lines: string[], name: string): string | undefined {
  const line = lines.find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

describe('Airline profiles (e2e, FLT-01)', () => {
  let app: NestExpressApplication | undefined;
  let airlines: Model<Airline> | undefined;
  let users: Model<User> | undefined;
  let uploads: UploadsService | undefined;
  let passwordHash: string;
  const createdAirlineIds: string[] = [];
  const createdUserIds: string[] = [];
  const uploadedLogoFilenames: string[] = [];

  const getHttpServer = () => {
    if (!app) throw new Error('Test application was not initialized');
    return app.getHttpServer();
  };

  const createUser = async (
    role: Role,
    assignedAirlineId?: string,
  ): Promise<TestUser> => {
    if (!users) throw new Error('User model was not initialized');
    const email = uniqueEmail();
    const user = await users.create({
      name: `FLT-01 ${role}`,
      email,
      passwordHash,
      role,
      status: UserStatus.Active,
      ...(assignedAirlineId && {
        assignment: {
          providerType: ProviderType.Airline,
          providerId: new Types.ObjectId(assignedAirlineId),
        },
      }),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    return { id, email };
  };

  const loginAs = async (user: TestUser): Promise<string> => {
    const response = await request(getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const token = cookieValue(setCookieLines(response), ACCESS_TOKEN_COOKIE);
    if (!token) throw new Error('Login did not set the access token cookie');
    return `${ACCESS_TOKEN_COOKIE}=${token}`;
  };

  const createAirline = async (
    cookie: string,
    code = uniqueCode(),
    name = 'Test Airline',
  ): Promise<AirlineResponseBody> => {
    const response = await request(getHttpServer())
      .post('/api/airlines')
      .set('Cookie', cookie)
      .field('name', name)
      .field('code', code)
      .attach('logo', png(), {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(201);
    const airline = response.body as AirlineResponseBody;
    createdAirlineIds.push(airline.id);
    uploadedLogoFilenames.push(airline.logo);
    return airline;
  };

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD, 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const testApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    app = testApp;
    configureApp(testApp);
    setupSwagger(testApp);
    await testApp.init();

    airlines = testApp.get<Model<Airline>>(getModelToken(Airline.name));
    users = testApp.get<Model<User>>(getModelToken(User.name));
    uploads = testApp.get(UploadsService);
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    const attemptCleanup = async (
      cleanup: () => PromiseLike<unknown>,
    ): Promise<void> => {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };

    try {
      const airlineModel = airlines;
      if (airlineModel) {
        for (const id of createdAirlineIds) {
          await attemptCleanup(() => airlineModel.findByIdAndDelete(id));
        }
      }

      // Each login creates a session (ACC-06): delete them before the accounts.
      const testApp = app;
      if (testApp) {
        for (const id of createdUserIds) {
          await attemptCleanup(() => deleteSessionsOf(testApp, id));
        }
      }

      const userModel = users;
      if (userModel) {
        for (const id of createdUserIds) {
          await attemptCleanup(() => userModel.findByIdAndDelete(id));
        }
      }

      const uploadsService = uploads;
      if (uploadsService) {
        for (const filename of uploadedLogoFilenames) {
          await attemptCleanup(() => uploadsService.deleteImage(filename));
        }
      }
    } finally {
      const testApp = app;
      if (testApp) await attemptCleanup(() => testApp.close());
    }

    if (cleanupErrors.length > 0) throw cleanupErrors[0];
  });

  describe('POST /api/airlines', () => {
    it('allows an administrator to create an airline with a logo', async () => {
      const admin = await createUser(Role.Admin);
      const cookie = await loginAs(admin);

      const airline = await createAirline(cookie);

      expect(airline).toMatchObject({
        name: 'Test Airline',
        active: true,
        logo: expect.stringMatching(/^[0-9a-f-]{36}\.png$/),
        logoUrl: expect.stringMatching(/^\/api\/uploads\//),
      });
      expect(airlines).toBeDefined();
      if (!airlines) throw new Error('Airline model was not initialized');
      expect(await airlines.findById(airline.id)).not.toBeNull();
    });

    it('returns 401 to an unauthenticated caller', async () => {
      await request(getHttpServer())
        .post('/api/airlines')
        .field('name', 'Guest Airline')
        .field('code', uniqueCode())
        .expect(401);
    });

    it('returns 403 when a non-admin user attempts to create an airline', async () => {
      const user = await createUser(Role.User);
      const cookie = await loginAs(user);

      await request(getHttpServer())
        .post('/api/airlines')
        .set('Cookie', cookie)
        .field('name', 'User Airline')
        .field('code', uniqueCode())
        .attach('logo', png(), {
          filename: 'logo.png',
          contentType: 'image/png',
        })
        .expect(403);
    });

    it('returns 409 when the airline code already exists', async () => {
      const admin = await createUser(Role.Admin);
      const cookie = await loginAs(admin);
      const code = uniqueCode();
      await createAirline(cookie, code);

      await request(getHttpServer())
        .post('/api/airlines')
        .set('Cookie', cookie)
        .field('name', 'Duplicate Airline')
        .field('code', code)
        .attach('logo', png('duplicate logo'), {
          filename: 'duplicate.png',
          contentType: 'image/png',
        })
        .expect(409);
    });

    it('returns 400 when the required logo is missing', async () => {
      const admin = await createUser(Role.Admin);
      const cookie = await loginAs(admin);

      await request(getHttpServer())
        .post('/api/airlines')
        .set('Cookie', cookie)
        .field('name', 'No Logo Airline')
        .field('code', uniqueCode())
        .expect(400);
    });

    it('returns 415 when the uploaded logo is not a JPG or PNG', async () => {
      const admin = await createUser(Role.Admin);
      const cookie = await loginAs(admin);

      await request(getHttpServer())
        .post('/api/airlines')
        .set('Cookie', cookie)
        .field('name', 'Invalid Logo Airline')
        .field('code', uniqueCode())
        .attach('logo', Buffer.from('not an image'), {
          filename: 'invalid.png',
          contentType: 'image/png',
        })
        .expect(415);
    });

    it.each(['active', '_id'])(
      'rejects the client-controlled field %s',
      async (field) => {
        const admin = await createUser(Role.Admin);
        const cookie = await loginAs(admin);
        const code = uniqueCode();
        const value =
          field === 'active' ? 'false' : new Types.ObjectId().toString();

        await request(getHttpServer())
          .post('/api/airlines')
          .set('Cookie', cookie)
          .field('name', 'Invalid Extra Field')
          .field('code', code)
          .field(field, value)
          .attach('logo', png(), {
            filename: 'logo.png',
            contentType: 'image/png',
          })
          .expect(400);

        expect(await airlines?.exists({ code })).toBeNull();
      },
    );
  });

  describe('GET /api/airlines/:id', () => {
    it('returns an airline profile to an authenticated user', async () => {
      const admin = await createUser(Role.Admin);
      const cookie = await loginAs(admin);
      const airline = await createAirline(cookie);

      const response = await request(getHttpServer())
        .get(`/api/airlines/${airline.id}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toMatchObject({
        id: airline.id,
        code: airline.code,
        logo: airline.logo,
        logoUrl: airline.logoUrl,
      });
      expect(response.body).not.toHaveProperty('_id');
    });

    it('returns 400 for a malformed airline ID', async () => {
      const user = await createUser(Role.User);
      const cookie = await loginAs(user);

      await request(getHttpServer())
        .get('/api/airlines/not-an-object-id')
        .set('Cookie', cookie)
        .expect(400);
    });

    it('returns 404 for an unknown valid ObjectId', async () => {
      const user = await createUser(Role.User);
      const cookie = await loginAs(user);

      await request(getHttpServer())
        .get(`/api/airlines/${new Types.ObjectId().toString()}`)
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('PATCH /api/airlines/:id', () => {
    it('returns 400 for a malformed airline ID', async () => {
      const admin = await createUser(Role.Admin);
      const adminCookie = await loginAs(admin);
      const airline = await createAirline(adminCookie);
      const moderator = await createUser(Role.AirlineModerator, airline.id);
      const moderatorCookie = await loginAs(moderator);

      await request(getHttpServer())
        .patch('/api/airlines/not-an-object-id')
        .set('Cookie', moderatorCookie)
        .field('name', 'Invalid ID Update')
        .expect(400);
    });

    it.each(['active', '_id'])(
      'rejects the client-controlled field %s on update',
      async (field) => {
        const admin = await createUser(Role.Admin);
        const adminCookie = await loginAs(admin);
        const airline = await createAirline(adminCookie);
        const moderator = await createUser(Role.AirlineModerator, airline.id);
        const moderatorCookie = await loginAs(moderator);
        const value =
          field === 'active' ? 'false' : new Types.ObjectId().toString();

        await request(getHttpServer())
          .patch(`/api/airlines/${airline.id}`)
          .set('Cookie', moderatorCookie)
          .field('name', 'Invalid Extra Field')
          .field(field, value)
          .expect(400);

        expect(
          await airlines?.findById(airline.id).then((stored) => stored?.name),
        ).toBe('Test Airline');
      },
    );

    it('allows the assigned airline moderator to update the profile', async () => {
      const admin = await createUser(Role.Admin);
      const adminCookie = await loginAs(admin);
      const airline = await createAirline(adminCookie);
      const moderator = await createUser(Role.AirlineModerator, airline.id);
      const moderatorCookie = await loginAs(moderator);

      const response = await request(getHttpServer())
        .patch(`/api/airlines/${airline.id}`)
        .set('Cookie', moderatorCookie)
        .field('name', 'Updated Airline')
        .expect(200);

      expect(response.body).toMatchObject({
        id: airline.id,
        name: 'Updated Airline',
        logo: airline.logo,
      });
    });

    it('returns 403 when a moderator updates another airline', async () => {
      const admin = await createUser(Role.Admin);
      const adminCookie = await loginAs(admin);
      const assignedAirline = await createAirline(adminCookie);
      const otherAirline = await createAirline(adminCookie);
      const moderator = await createUser(
        Role.AirlineModerator,
        assignedAirline.id,
      );
      const moderatorCookie = await loginAs(moderator);

      await request(getHttpServer())
        .patch(`/api/airlines/${otherAirline.id}`)
        .set('Cookie', moderatorCookie)
        .field('name', 'Unauthorized Update')
        .expect(403);
    });

    it('returns 403 when an administrator uses the moderator-only endpoint', async () => {
      const admin = await createUser(Role.Admin);
      const cookie = await loginAs(admin);
      const airline = await createAirline(cookie);

      await request(getHttpServer())
        .patch(`/api/airlines/${airline.id}`)
        .set('Cookie', cookie)
        .field('name', 'Admin Update')
        .expect(403);
    });

    it('replaces a logo and removes the old uploaded file', async () => {
      const admin = await createUser(Role.Admin);
      const adminCookie = await loginAs(admin);
      const airline = await createAirline(adminCookie);
      if (!uploads) throw new Error('Uploads service was not initialized');
      const oldLogoPath = join(uploads.directory, airline.logo);
      expect(existsSync(oldLogoPath)).toBe(true);

      const moderator = await createUser(Role.AirlineModerator, airline.id);
      const moderatorCookie = await loginAs(moderator);
      const response = await request(getHttpServer())
        .patch(`/api/airlines/${airline.id}`)
        .set('Cookie', moderatorCookie)
        .attach('logo', png('replacement logo'), {
          filename: 'replacement.png',
          contentType: 'image/png',
        })
        .expect(200);
      const updated = response.body as AirlineResponseBody;
      uploadedLogoFilenames.push(updated.logo);

      expect(updated.logo).not.toBe(airline.logo);
      expect(existsSync(oldLogoPath)).toBe(false);
      expect(existsSync(join(uploads.directory, updated.logo))).toBe(true);
    });
  });

  it('documents the FLT-01 routes in Swagger with the requirement ID', async () => {
    const response = await request(getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, { tags: string[]; description?: string }>
    >;
    const operations = [
      paths['/api/airlines'].post,
      paths['/api/airlines/{id}'].get,
      paths['/api/airlines/{id}'].patch,
    ];

    for (const operation of operations) {
      expect(operation.tags).toEqual(['Airlines']);
      expect(operation.description).toMatch(/^FLT-01\. /);
    }
  });

  it('shows the name, code and logo fields in the Swagger forms', async () => {
    const response = await request(getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const formOf = (path: string, method: 'post' | 'patch') =>
      response.body.paths[path][method].requestBody.content[
        'multipart/form-data'
      ].schema as { required?: string[]; properties: Record<string, unknown> };

    const create = formOf('/api/airlines', 'post');
    const update = formOf('/api/airlines/{id}', 'patch');

    expect(Object.keys(create.properties)).toEqual(['name', 'code', 'logo']);
    expect(create.required).toEqual(['name', 'code', 'logo']);
    expect(Object.keys(update.properties)).toEqual(['name', 'code', 'logo']);
    expect(update.required ?? []).toEqual([]);
  });
});
