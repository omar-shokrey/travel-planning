import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { compare } from 'bcrypt';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { CONSENT_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { PASSWORD_RULE } from './../src/common/constants/password';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';
import { EMAIL_TAKEN_MESSAGE } from './../src/users/users.service';

const PASSWORD = 'Passw0rdOK';

/** A new address on every call, so a leftover of a stopped run never collides. */
const uniqueEmail = (): string => `acc01-${randomUUID()}@example.com`;

const validBody = () => ({
  name: 'Sara Ahmed',
  email: uniqueEmail(),
  password: PASSWORD,
  acceptedTerms: true,
});

describe('POST /api/auth/register (e2e, ACC-01)', () => {
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

  it('creates the account and returns its public fields', async () => {
    const body = validBody();

    const response = await register(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      name: 'Sara Ahmed',
      email: body.email,
      role: 'user',
      status: 'active',
      mustChangePassword: false,
      createdAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
    });
  });

  it('does not log the new user in', async () => {
    const response = await register(validBody());

    expect(response.status).toBe(201);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('stores a password hash, the user role and the consent time', async () => {
    const before = Date.now();
    const response = await register(validBody());
    expect(response.status).toBe(201);

    const stored = await users
      .findById(response.body.id)
      .select('+passwordHash')
      .orFail();

    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(await compare(PASSWORD, stored.passwordHash)).toBe(true);
    expect(stored.role).toBe(Role.User);
    expect(stored.status).toBe(UserStatus.Active);
    expect(stored.failedLoginAttempts).toBe(0);
    expect(stored.consentAcceptedAt).toBeInstanceOf(Date);
    expect(stored.consentAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('trims the name, and trims and lowercases the email', async () => {
    const email = uniqueEmail();

    const response = await register({
      ...validBody(),
      name: '  Sara Ahmed ',
      email: `  ${email.toUpperCase()} `,
    });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('Sara Ahmed');
    expect(response.body.email).toBe(email);
  });

  it('rejects an email that is already registered, in any letter case', async () => {
    const body = validBody();
    expect((await register(body)).status).toBe(201);

    const same = await register(body);
    const upperCase = await register({
      ...body,
      email: body.email.toUpperCase(),
    });

    expect(same.status).toBe(409);
    expect(same.body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      message: EMAIL_TAKEN_MESSAGE,
      path: '/api/auth/register',
    });
    expect(same.body.errors).toBeUndefined();
    expect(upperCase.status).toBe(409);
    expect(await users.countDocuments({ email: body.email })).toBe(1);
  });

  it('rejects a password that breaks the rule, with a message for the field', async () => {
    const response = await register({ ...validBody(), password: 'weakpass' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: '/api/auth/register',
    });
    expect(response.body.errors).toEqual([
      { field: 'password', messages: [`password ${PASSWORD_RULE}`] },
    ]);
  });

  it('rejects an email that is not an email', async () => {
    const response = await register({ ...validBody(), email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { field: 'email', messages: ['email must be an email'] },
    ]);
  });

  it.each([
    ['false', false],
    ['missing', undefined],
  ])('rejects a consent that is %s', async (_case, acceptedTerms) => {
    const body = validBody();

    const response = await register({ ...body, acceptedTerms });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { field: 'acceptedTerms', messages: [CONSENT_REQUIRED_MESSAGE] },
    ]);
    expect(await users.exists({ email: body.email })).toBeNull();
  });

  it('rejects a body that tries to set the role', async () => {
    const body = validBody();

    const response = await register({ ...body, role: Role.Admin });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { field: 'role', messages: ['property role should not exist'] },
    ]);
    expect(await users.exists({ email: body.email })).toBeNull();
  });

  it('reports every invalid field of an empty body', async () => {
    const response = await register({});

    expect(response.status).toBe(400);
    const fields = (response.body.errors as { field: string }[])
      .map(({ field }) => field)
      .sort();
    expect(fields).toEqual(['acceptedTerms', 'email', 'name', 'password']);
  });

  it('documents the route in Swagger', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const route = response.body.paths['/api/auth/register'].post;
    expect(route.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/RegisterDto',
    );
    expect(route.responses['201'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/UserResponseDto',
    );
    expect(Object.keys(route.responses)).toEqual(
      expect.arrayContaining(['201', '400', '409']),
    );
    expect(
      Object.keys(
        response.body.components.schemas.RegisterDto.properties,
      ).sort(),
    ).toEqual(['acceptedTerms', 'email', 'name', 'password']);
  });
});
