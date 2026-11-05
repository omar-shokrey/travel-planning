import { validateEnv } from './env.validation';

const invalidCases: [Record<string, string>, RegExp][] = [
  [{ PORT: 'abc' }, /PORT/],
  [{ PORT: '0' }, /PORT/],
  [{ PORT: '70000' }, /PORT/],
  [{ PORT: '' }, /PORT/],
  [{ FRONTEND_URL: 'not a url' }, /FRONTEND_URL/],
  [{ FRONTEND_URL: 'localhost:3000' }, /FRONTEND_URL/],
  [{ FRONTEND_URL: '' }, /FRONTEND_URL/],
];

describe('validateEnv', () => {
  it('uses the local development defaults when nothing is set', () => {
    const env = validateEnv({});

    expect(env.PORT).toBe(3001);
    expect(env.FRONTEND_URL).toBe('http://localhost:3000');
  });

  it('turns the PORT string into a number', () => {
    expect(validateEnv({ PORT: '4000' }).PORT).toBe(4000);
  });

  it('accepts the frontend URL it is given', () => {
    const env = validateEnv({ FRONTEND_URL: 'https://app.example.com' });
    expect(env.FRONTEND_URL).toBe('https://app.example.com');
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
