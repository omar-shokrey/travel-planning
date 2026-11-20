import { isMailSender, isSmtpHost, validateEnv } from './env.validation';

const MONGODB_URI = 'mongodb://localhost:27017/travel-planning-test';
const base = { MONGODB_URI };

const invalidCases: [Record<string, unknown>, RegExp][] = [
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
  [{ STRIPE_SECRET_KEY: 'sk_live_abc123' }, /STRIPE_SECRET_KEY/],
  [{ STRIPE_SECRET_KEY: 'rk_live_abc123' }, /STRIPE_SECRET_KEY/],
  [{ STRIPE_SECRET_KEY: 'pk_test_abc123' }, /STRIPE_SECRET_KEY/],
  [{ STRIPE_SECRET_KEY: 'sk_test_' }, /STRIPE_SECRET_KEY/],
  [{ STRIPE_SECRET_KEY: 'sk_test_has space' }, /STRIPE_SECRET_KEY/],
  [{ STRIPE_WEBHOOK_SECRET: 'abc123' }, /STRIPE_WEBHOOK_SECRET/],
  [{ STRIPE_WEBHOOK_SECRET: 'whsec_' }, /STRIPE_WEBHOOK_SECRET/],
  [{ SMTP_HOST: 'mail host' }, /SMTP_HOST/],
  [{ SMTP_HOST: 'smtp://mail.example.com' }, /SMTP_HOST/],
  [{ SMTP_HOST: '.' }, /SMTP_HOST/],
  [{ SMTP_HOST: '-host' }, /SMTP_HOST/],
  [{ SMTP_USER: 42 }, /SMTP_USER/],
  [{ SMTP_PASSWORD: 42 }, /SMTP_PASSWORD/],
  [{ SMTP_PORT: '0' }, /SMTP_PORT/],
  [{ SMTP_PORT: '70000' }, /SMTP_PORT/],
  [{ SMTP_PORT: 'abc' }, /SMTP_PORT/],
  [{ SMTP_PORT: '' }, /SMTP_PORT/],
  [{ SMTP_PORT: '25.5' }, /SMTP_PORT/],
  [{ SMTP_SECURE: 'yes' }, /SMTP_SECURE/],
  [{ SMTP_SECURE: '' }, /SMTP_SECURE/],
  [{ SMTP_HOST: 'localhost', MAIL_FROM: 'not-an-address' }, /MAIL_FROM/],
  [{ SMTP_HOST: 'localhost', MAIL_FROM: '' }, /MAIL_FROM/],
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
    expect(env.STRIPE_SECRET_KEY).toBe('');
    expect(env.STRIPE_WEBHOOK_SECRET).toBe('');
    expect(env.SMTP_HOST).toBe('');
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.SMTP_USER).toBe('');
    expect(env.SMTP_PASSWORD).toBe('');
    expect(env.MAIL_FROM).toBe(
      'Travel Platform <no-reply@travel-platform.local>',
    );
  });

  it('reads a full set of SMTP settings (GEN-01-B) and turns port and TLS into a number and a boolean', () => {
    const env = validateEnv({
      ...base,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 's3cret-pass',
      MAIL_FROM: 'Travel Platform <no-reply@example.com>',
    });

    expect(env).toMatchObject({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 's3cret-pass',
      MAIL_FROM: 'Travel Platform <no-reply@example.com>',
    });
  });

  it('accepts a local test inbox host (localhost, an IP or a container name) on port 1025 with no login', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', 'mailpit']) {
      const env = validateEnv({ ...base, SMTP_HOST: host, SMTP_PORT: '1025' });
      expect(env.SMTP_HOST).toBe(host);
      expect(env.SMTP_PORT).toBe(1025);
      expect(env.SMTP_USER).toBe('');
      expect(env.SMTP_PASSWORD).toBe('');
    }
  });

  it('reads SMTP_SECURE=false as false', () => {
    expect(validateEnv({ ...base, SMTP_SECURE: 'false' }).SMTP_SECURE).toBe(
      false,
    );
  });

  it('accepts an empty SMTP_HOST, which switches email off, and then does not check MAIL_FROM', () => {
    const env = validateEnv({
      ...base,
      SMTP_HOST: '',
      MAIL_FROM: 'not-an-address',
    });

    expect(env.SMTP_HOST).toBe('');
    expect(env.MAIL_FROM).toBe('not-an-address');
  });

  it('accepts a plain address as MAIL_FROM when SMTP_HOST is set', () => {
    expect(
      validateEnv({
        ...base,
        SMTP_HOST: 'localhost',
        MAIL_FROM: 'no-reply@example.com',
      }).MAIL_FROM,
    ).toBe('no-reply@example.com');
  });

  it('never prints an SMTP value in the error, only the variable names', () => {
    const message = errorMessage({
      ...base,
      SMTP_HOST: 'secret-host value',
      SMTP_PORT: '0',
      SMTP_USER: 42,
      SMTP_PASSWORD: 43,
      MAIL_FROM: 'secret-sender value',
    });

    for (const name of [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'MAIL_FROM',
    ]) {
      expect(message).toMatch(name);
    }
    expect(message).not.toContain('secret-host');
    expect(message).not.toContain('secret-sender');
    expect(message).not.toMatch(/\b4[23]\b/);
  });

  it('keeps a valid login out of the error when another SMTP setting is wrong', () => {
    const message = errorMessage({
      ...base,
      SMTP_HOST: 'localhost',
      SMTP_PORT: '0',
      SMTP_USER: 'secret-login',
      SMTP_PASSWORD: 'secret-password',
    });

    expect(message).toMatch(/SMTP_PORT/);
    expect(message).not.toContain('secret-login');
    expect(message).not.toContain('secret-password');
  });

  it('reads the Stripe settings (PAY-01), and both may stay empty', () => {
    const env = validateEnv({
      ...base,
      STRIPE_SECRET_KEY: 'sk_test_abc123',
      STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
    });
    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_abc123');
    expect(env.STRIPE_WEBHOOK_SECRET).toBe('whsec_abc123');
    expect(
      validateEnv({ ...base, STRIPE_SECRET_KEY: 'rk_test_abc123' })
        .STRIPE_SECRET_KEY,
    ).toBe('rk_test_abc123');
    expect(
      validateEnv({ ...base, STRIPE_SECRET_KEY: '' }).STRIPE_SECRET_KEY,
    ).toBe('');
  });

  it('refuses a live Stripe key: the platform only works in test mode', () => {
    expect(
      errorMessage({ ...base, STRIPE_SECRET_KEY: 'sk_live_abc123' }),
    ).toMatch(/STRIPE_SECRET_KEY/);
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

describe('isMailSender (GEN-01-B)', () => {
  it.each([
    'no-reply@example.com',
    'Travel Platform <no-reply@example.com>',
    'Travel Platform<no-reply@example.com>',
    'Travel Platform <no-reply@travel-platform.local>',
  ])('accepts %p', (value) => {
    expect(isMailSender(value)).toBe(true);
  });

  it.each([
    ['an address without a domain', 'no-reply'],
    ['an address without a top-level domain', 'no-reply@localhost'],
    ['a bad address inside the brackets', 'Travel Platform <not-an-address>'],
    ['an unclosed bracket', 'Travel Platform <no-reply@example.com'],
    ['brackets with no name before them', '<no-reply@example.com>'],
    [
      'a line break that would add a header',
      'Travel\r\nBcc: x@example.com <no-reply@example.com>',
    ],
    ['a quote in the name', 'Travel "Platform" <no-reply@example.com>'],
    ['two addresses', 'a@example.com, b@example.com'],
    [
      'a second address before a named one',
      'a@example.com, Evil <x@example.com>',
    ],
    ['a comma in the name', 'Evil, Co <x@example.com>'],
    ['a colon (an address group)', 'group: <x@example.com>'],
    ['a tab or a NUL in the name', 'Name\t\u0000 <x@example.com>'],
    ['a Unicode line separator in the name', 'Name\u2028Bcc <x@example.com>'],
    ['a name that is only spaces', '   <x@example.com>'],
    ['an empty value', ''],
    ['a value that is not text', 42],
  ])('refuses %s', (_case, value) => {
    expect(isMailSender(value)).toBe(false);
  });
});

describe('isSmtpHost (GEN-01-B)', () => {
  it.each([
    'smtp.example.com',
    'localhost',
    'mailpit',
    'mail_pit',
    '127.0.0.1',
    '::1',
  ])('accepts %p', (value) => {
    expect(isSmtpHost(value)).toBe(true);
  });

  it.each([
    ['a dot', '.'],
    ['a leading hyphen', '-host'],
    ['a space', 'mail host'],
    ['a URL', 'smtp://mail.example.com'],
    ['a host with a port', 'localhost:1025'],
    ['an empty value', ''],
    ['a value that is not text', 25],
  ])('refuses %s', (_case, value) => {
    expect(isSmtpHost(value)).toBe(false);
  });
});
