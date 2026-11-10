import { validateSeedEnv } from './seed.env';

const env = {
  MONGODB_URI: 'mongodb://localhost:27017/test',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'Admin12345',
};

const messageOf = (config: Record<string, unknown>): string => {
  try {
    validateSeedEnv(config);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe('validateSeedEnv', () => {
  it('accepts valid values and keeps the checked app settings', () => {
    const result = validateSeedEnv(env);

    expect(result.ADMIN_EMAIL).toBe('admin@example.com');
    expect(result.ADMIN_PASSWORD).toBe('Admin12345');
    expect(result.PORT).toBe(3001);
  });

  it.each([undefined, '', 'admin', 'admin@'])(
    'rejects the email %p',
    (ADMIN_EMAIL) => {
      expect(messageOf({ ...env, ADMIN_EMAIL })).toContain(
        'ADMIN_EMAIL must be a valid email address',
      );
    },
  );

  it.each([undefined, '', 'Ab1', 'abcdefgh', '12345678'])(
    'rejects the password %p',
    (ADMIN_PASSWORD) => {
      expect(messageOf({ ...env, ADMIN_PASSWORD })).toContain(
        'ADMIN_PASSWORD must be at least 8 characters and include a letter and a digit',
      );
    },
  );

  it('never repeats the password in the message', () => {
    expect(messageOf({ ...env, ADMIN_PASSWORD: 'abc1' })).not.toContain('abc1');
  });

  it('still checks the app settings first', () => {
    expect(messageOf({ ...env, MONGODB_URI: undefined })).toContain(
      'MONGODB_URI',
    );
  });
});
