import { validateEnv } from './env.validation';

const MONGODB_URI = 'mongodb://localhost:27017/travel-planning-test';
const base = { MONGODB_URI };

const invalidCases: [Record<string, string>, RegExp][] = [
  [{ PORT: 'abc' }, /PORT/],
  [{ PORT: '0' }, /PORT/],
  [{ PORT: '70000' }, /PORT/],
  [{ PORT: '' }, /PORT/],
  [{ FRONTEND_URL: 'not a url' }, /FRONTEND_URL/],
  [{ FRONTEND_URL: 'localhost:3000' }, /FRONTEND_URL/],
  [{ FRONTEND_URL: '' }, /FRONTEND_URL/],
  [{ UPLOADS_DIR: '' }, /UPLOADS_DIR/],
  [{ ACCESS_TOKEN_MINUTES: '0' }, /ACCESS_TOKEN_MINUTES/],
  [{ ACCESS_TOKEN_MINUTES: 'ten' }, /ACCESS_TOKEN_MINUTES/],
  [{ SESSION_INACTIVITY_MINUTES: '5000' }, /SESSION_INACTIVITY_MINUTES/],
  [{ COOKIE_SECURE: 'yes' }, /COOKIE_SECURE/],
  [{ COOKIE_SECURE: '' }, /COOKIE_SECURE/],
  [{ COOKIE_SAME_SITE: 'banana' }, /COOKIE_SAME_SITE/],
  [{ MONGODB_URI: '' }, /MONGODB_URI/],
  [{ MONGODB_URI: 'localhost:27017' }, /MONGODB_URI/],
  [{ MONGODB_URI: 'http://cluster.example.com' }, /MONGODB_URI/],
  [{ MONGODB_URI: 'mongodb+srv://user:pass@host with space' }, /MONGODB_URI/],
  [{ FXRATES_API_URL: 'not a url' }, /FXRATES_API_URL/],
  [{ FXRATES_API_URL: 'api.fxratesapi.com' }, /FXRATES_API_URL/],
  [{ FXRATES_API_URL: '' }, /FXRATES_API_URL/],
];

const errorMessage = (env: Record<string, unknown>): string => {
  try {
    validateEnv(env);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('validateEnv', () => {
  it('uses the local development defaults when only the database is set', () => {
    const env = validateEnv(base);

    expect(env.MONGODB_URI).toBe(MONGODB_URI);
    expect(env.PORT).toBe(3001);
    expect(env.FRONTEND_URL).toBe('http://localhost:3000');
    expect(env.UPLOADS_DIR).toBe('uploads');
    expect(env.ACCESS_TOKEN_MINUTES).toBe(10);
    expect(env.SESSION_INACTIVITY_MINUTES).toBe(30);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.COOKIE_SAME_SITE).toBe('lax');
    expect(env.FXRATES_API_KEY).toBe('');
    expect(env.FXRATES_API_URL).toBe('https://api.fxratesapi.com');
  });

  it('reads the exchange-rate settings (ITN-18), and an empty key is allowed', () => {
    const env = validateEnv({
      ...base,
      FXRATES_API_KEY: 'test-key',
      FXRATES_API_URL: 'http://127.0.0.1:4010',
    });
    expect(env.FXRATES_API_KEY).toBe('test-key');
    expect(env.FXRATES_API_URL).toBe('http://127.0.0.1:4010');
    expect(validateEnv({ ...base, FXRATES_API_KEY: '' }).FXRATES_API_KEY).toBe(
      '',
    );
  });

  it('turns the PORT string into a number', () => {
    expect(validateEnv({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('accepts the frontend URL it is given', () => {
    const env = validateEnv({
      ...base,
      FRONTEND_URL: 'https://app.example.com',
    });
    expect(env.FRONTEND_URL).toBe('https://app.example.com');
  });

  it('reads the uploads folder', () => {
    const env = validateEnv({ ...base, UPLOADS_DIR: 'files/images' });
    expect(env.UPLOADS_DIR).toBe('files/images');
  });

  it('reads the session and cookie settings', () => {
    const env = validateEnv({
      ...base,
      ACCESS_TOKEN_MINUTES: '5',
      SESSION_INACTIVITY_MINUTES: '45',
      COOKIE_SECURE: 'false',
      COOKIE_SAME_SITE: 'strict',
    });

    expect(env.ACCESS_TOKEN_MINUTES).toBe(5);
    expect(env.SESSION_INACTIVITY_MINUTES).toBe(45);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.COOKIE_SAME_SITE).toBe('strict');
  });

  it('reads COOKIE_SECURE=true as true', () => {
    expect(validateEnv({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(
      true,
    );
  });

  it.each([
    'mongodb://localhost:27017/travel-planning',
    'mongodb+srv://user:p%40ss@cluster.example.mongodb.net/travel-planning?retryWrites=true&w=majority',
  ])('accepts the connection string %s', (uri) => {
    expect(validateEnv({ MONGODB_URI: uri }).MONGODB_URI).toBe(uri);
  });

  it('requires the connection string', () => {
    expect(errorMessage({})).toMatch(/MONGODB_URI/);
  });

  it('never prints the connection string in the error', () => {
    const message = errorMessage({
      MONGODB_URI: 'http://user:secret-password@cluster.example.com',
    });

    expect(message).toMatch(/MONGODB_URI/);
    expect(message).not.toContain('secret-password');
  });

  it('ignores variables it does not know', () => {
    expect(() => validateEnv({ ...base, PATH: '/usr/bin' })).not.toThrow();
  });

  it.each(invalidCases)('rejects %j and names the variable', (env, name) => {
    const message = errorMessage({ ...base, ...env });

    expect(message).toMatch(/Invalid environment variables/);
    expect(message).toMatch(name);
  });
});
