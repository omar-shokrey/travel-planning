import { validateEnv } from './env.validation';

const invalidCases: [Record<string, string>, RegExp][] = [
  [{ PORT: 'abc' }, /PORT/],
  [{ PORT: '0' }, /PORT/],
  [{ PORT: '70000' }, /PORT/],
  [{ PORT: '' }, /PORT/],
  [{ FRONTEND_URL: 'not a url' }, /FRONTEND_URL/],
  [{ FRONTEND_URL: 'localhost:3000' }, /FRONTEND_URL/],
  [{ FRONTEND_URL: '' }, /FRONTEND_URL/],
  [{ ACCESS_TOKEN_MINUTES: '0' }, /ACCESS_TOKEN_MINUTES/],
  [{ ACCESS_TOKEN_MINUTES: 'ten' }, /ACCESS_TOKEN_MINUTES/],
  [{ SESSION_INACTIVITY_MINUTES: '5000' }, /SESSION_INACTIVITY_MINUTES/],
  [{ COOKIE_SECURE: 'yes' }, /COOKIE_SECURE/],
  [{ COOKIE_SECURE: '' }, /COOKIE_SECURE/],
  [{ COOKIE_SAME_SITE: 'banana' }, /COOKIE_SAME_SITE/],
];

describe('validateEnv', () => {
  it('uses the local development defaults when nothing is set', () => {
    const env = validateEnv({});

    expect(env.PORT).toBe(3001);
    expect(env.FRONTEND_URL).toBe('http://localhost:3000');
    expect(env.ACCESS_TOKEN_MINUTES).toBe(10);
    expect(env.SESSION_INACTIVITY_MINUTES).toBe(30);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.COOKIE_SAME_SITE).toBe('lax');
  });

  it('turns the PORT string into a number', () => {
    expect(validateEnv({ PORT: '4000' }).PORT).toBe(4000);
  });

  it('accepts the frontend URL it is given', () => {
    const env = validateEnv({ FRONTEND_URL: 'https://app.example.com' });
    expect(env.FRONTEND_URL).toBe('https://app.example.com');
  });

  it('reads the session and cookie settings', () => {
    const env = validateEnv({
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
    expect(validateEnv({ COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('ignores variables it does not know', () => {
    const env = { PATH: '/usr/bin', MONGODB_URI: '' };
    expect(() => validateEnv(env)).not.toThrow();
  });

  it.each(invalidCases)('rejects %j and names the variable', (env, name) => {
    expect(() => validateEnv(env)).toThrow(/Invalid environment variables/);
    expect(() => validateEnv(env)).toThrow(name);
  });
});
