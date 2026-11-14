import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { CONSENT_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { PASSWORD_RULE } from './../src/common/constants/password';
import type { FieldError } from './../src/common/interfaces/error-response.interface';

const PASSWORD = 'Passw0rdOK';

/**
 * GEN-02: a form that is filled in wrongly gets one message list per field,
 * so the frontend can show each message under its field. These tests send bad
 * bodies to the real routes and read the error body the way the frontend will.
 * They create nothing in the database: every request is rejected before it
 * reaches a service.
 */
describe('Field-level validation messages (e2e, GEN-02)', () => {
  let app: NestExpressApplication;

  const post = (path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(path).send(body);

  const fieldsOf = (body: { errors?: FieldError[] }): string[] =>
    (body.errors ?? []).map(({ field }) => field).sort();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports every invalid field of one request at once', async () => {
    const response = await post('/api/auth/register', {
      name: 'Sara Ahmed',
      email: 'not-an-email',
      password: 'weakpass',
      acceptedTerms: false,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: '/api/auth/register',
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(fieldsOf(response.body)).toEqual([
      'acceptedTerms',
      'email',
      'password',
    ]);
  });

  it('gives each field its own messages and no field an empty list', async () => {
    const response = await post('/api/auth/register', {
      name: 'Sara Ahmed',
      email: 'not-an-email',
      password: 'weakpass',
      acceptedTerms: false,
    });

    const errors = response.body.errors as FieldError[];
    expect(errors).toEqual(
      expect.arrayContaining([
        { field: 'email', messages: ['email must be an email'] },
        { field: 'password', messages: [`password ${PASSWORD_RULE}`] },
        { field: 'acceptedTerms', messages: [CONSENT_REQUIRED_MESSAGE] },
      ]),
    );
    for (const { messages } of errors) {
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message.trim()).not.toBe('');
      }
    }
  });

  it('reports a name that is only spaces as an empty name', async () => {
    const response = await post('/api/auth/register', {
      name: '   ',
      email: 'sara@example.com',
      password: PASSWORD,
      acceptedTerms: true,
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { field: 'name', messages: ['name should not be empty'] },
    ]);
  });

  it('reports a password that is too long on the password field', async () => {
    const response = await post('/api/auth/register', {
      name: 'Sara Ahmed',
      email: 'sara@example.com',
      password: `a1${'x'.repeat(80)}`,
      acceptedTerms: true,
    });

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toEqual(['password']);
    expect(response.body.errors[0].messages).toEqual([
      expect.stringContaining('72'),
    ]);
  });

  describe('POST /api/auth/login', () => {
    it('names both fields when the body is empty', async () => {
      const response = await post('/api/auth/login', {});

      expect(response.status).toBe(400);
      expect(fieldsOf(response.body)).toEqual(['email', 'password']);
    });

    it('puts the email problem on the email field', async () => {
      const response = await post('/api/auth/login', {
        email: 'nope',
        password: PASSWORD,
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'email', messages: ['email must be an email'] },
      ]);
    });

    it('puts a password that is not a text on the password field', async () => {
      const response = await post('/api/auth/login', {
        email: 'sara@example.com',
        password: 12345678,
      });

      expect(response.status).toBe(400);
      expect(fieldsOf(response.body)).toEqual(['password']);
    });

    it('names a field that is not allowed', async () => {
      const response = await post('/api/auth/login', {
        email: 'sara@example.com',
        password: PASSWORD,
        role: 'admin',
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        { field: 'role', messages: ['property role should not exist'] },
      ]);
    });
  });

  describe('a request that is not valid JSON', () => {
    it('answers 400 in the standard error shape, without a field list', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        path: '/api/auth/login',
      });
      expect(response.body.message).toEqual(expect.any(String));
      expect(response.body.errors).toBeUndefined();
    });
  });
});
