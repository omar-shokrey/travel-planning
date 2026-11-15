import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { compare } from 'bcrypt';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { PASSWORD_SALT_ROUNDS } from './../src/common/constants/password';
import { User } from './../src/users/models/user.schema';

const PASSWORD = 'Passw0rdOK';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `gen13-${randomUUID()}@example.com`;

const validBody = () => ({
  name: 'Sara Ahmed',
  email: uniqueEmail(),
  password: PASSWORD,
  acceptedTerms: true,
});

/**
 * GEN-13: the backend enforces the rules whatever the frontend does, and
 * passwords are stored only as salted hashes. These tests talk to the API
 * directly, the way a client that skips every frontend check would. Who may
 * call a route is tested in auth-login.e2e-spec.ts.
 */
describe('Backend enforcement and password storage (e2e, GEN-13)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  /** The accounts these tests created. Each one is deleted by id at the end. */
  const createdIds: string[] = [];

  const register = async (body: Record<string, unknown>) => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body);
    if (response.status === 201) {
      createdIds.push(response.body.id);
    }
    return response;
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
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('passwords are stored only as salted hashes', () => {
    it('stores a bcrypt hash with the project cost and no plain password', async () => {
      const response = await register(validBody());
      expect(response.status).toBe(201);

      const stored = await users
        .findById(response.body.id)
        .select('+passwordHash')
        .lean()
        .orFail();

      expect(stored.passwordHash).toMatch(
        new RegExp(`^\\$2[aby]\\$${PASSWORD_SALT_ROUNDS}\\$`),
      );
      expect(await compare(PASSWORD, stored.passwordHash)).toBe(true);
      expect(Object.keys(stored)).not.toContain('password');
      expect(JSON.stringify(stored)).not.toContain(PASSWORD);
    });

    it('gives two accounts with the same password different hashes', async () => {
      const first = await register(validBody());
      const second = await register(validBody());
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const [firstStored, secondStored] = await Promise.all(
        [first, second].map((response) =>
          users
            .findById(response.body.id)
            .select('+passwordHash')
            .lean()
            .orFail(),
        ),
      );

      expect(firstStored.passwordHash).not.toBe(secondStored.passwordHash);
      expect(await compare(PASSWORD, firstStored.passwordHash)).toBe(true);
      expect(await compare(PASSWORD, secondStored.passwordHash)).toBe(true);
    });

    it('never sends the password or its hash back', async () => {
      const response = await register(validBody());

      expect(response.status).toBe(201);
      const body = JSON.stringify(response.body);
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toContain('$2');
      expect(body).not.toMatch(/password/i);
    });

    it('does not repeat a rejected password in the error', async () => {
      // No digit, so the password rule rejects it.
      const rejected = 'Only-letters-in-this-password';

      const response = await register({ ...validBody(), password: rejected });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(rejected);
    });
  });

  describe('the client cannot set a field that the server controls', () => {
    it.each([
      ['role', 'airline_moderator'],
      ['status', 'suspended'],
      [
        'passwordHash',
        '$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz0123',
      ],
      ['failedLoginAttempts', 0],
      ['consentAcceptedAt', '2020-01-01T00:00:00.000Z'],
      ['createdAt', '2020-01-01T00:00:00.000Z'],
      ['id', '6741a2b3c4d5e6f708192a3b'],
      ['_id', '6741a2b3c4d5e6f708192a3b'],
    ])('rejects %s in the registration body', async (field, value) => {
      const body = validBody();

      const response = await register({ ...body, [field]: value });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field, messages: [`property ${field} should not exist`] },
      ]);
      expect(await users.exists({ email: body.email })).toBeNull();
    });
  });
});
