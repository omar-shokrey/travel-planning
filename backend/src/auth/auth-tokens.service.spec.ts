import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthTokensService } from './auth-tokens.service';

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const ACCESS_SECRET = 'access-secret-for-the-unit-tests';
const REFRESH_SECRET = 'refresh-secret-for-the-unit-tests';

interface DecodedToken {
  header: { alg: string };
  payload: { sub?: string; iat: number; exp: number };
}

function setup(settings: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    JWT_ACCESS_SECRET: ACCESS_SECRET,
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    ACCESS_TOKEN_MINUTES: 10,
    SESSION_INACTIVITY_MINUTES: 30,
    ...settings,
  };
  const config = {
    get: jest.fn((name: string) => values[name]),
    getOrThrow: jest.fn((name: string) => {
      if (values[name] === undefined) {
        throw new Error(`${name} is not set`);
      }
      return values[name];
    }),
  };
  const jwt = new JwtService();
  const service = new AuthTokensService(
    jwt,
    config as unknown as ConfigService,
  );
  const decode = (token: string): DecodedToken =>
    jwt.decode(token, { complete: true }) as DecodedToken;

  return { jwt, service, decode };
}

describe('AuthTokensService', () => {
  describe('issueTokens', () => {
    it('issues an access token and a refresh token for the user', async () => {
      const { service, decode } = setup();

      const { accessToken, refreshToken } = await service.issueTokens(USER_ID);

      expect(decode(accessToken).payload.sub).toBe(USER_ID);
      expect(decode(refreshToken).payload.sub).toBe(USER_ID);
      expect(accessToken).not.toBe(refreshToken);
    });

    it('carries nothing but the user id and the times', async () => {
      const { service, decode } = setup();

      const { accessToken } = await service.issueTokens(USER_ID);

      expect(Object.keys(decode(accessToken).payload).sort()).toEqual([
        'exp',
        'iat',
        'sub',
      ]);
    });

    it('makes the access token last ACCESS_TOKEN_MINUTES', async () => {
      const { service, decode } = setup({ ACCESS_TOKEN_MINUTES: 7 });

      const { accessToken } = await service.issueTokens(USER_ID);

      const { iat, exp } = decode(accessToken).payload;
      expect(exp - iat).toBe(7 * 60);
    });

    it('makes the refresh token last SESSION_INACTIVITY_MINUTES', async () => {
      const { service, decode } = setup({ SESSION_INACTIVITY_MINUTES: 45 });

      const { refreshToken } = await service.issueTokens(USER_ID);

      const { iat, exp } = decode(refreshToken).payload;
      expect(exp - iat).toBe(45 * 60);
    });

    it('signs each token with its own secret and with HS256', async () => {
      const { jwt, service, decode } = setup();

      const { accessToken, refreshToken } = await service.issueTokens(USER_ID);

      await expect(
        jwt.verifyAsync(accessToken, { secret: ACCESS_SECRET }),
      ).resolves.toBeDefined();
      await expect(
        jwt.verifyAsync(refreshToken, { secret: REFRESH_SECRET }),
      ).resolves.toBeDefined();
      await expect(
        jwt.verifyAsync(accessToken, { secret: REFRESH_SECRET }),
      ).rejects.toThrow();
      await expect(
        jwt.verifyAsync(refreshToken, { secret: ACCESS_SECRET }),
      ).rejects.toThrow();
      expect(decode(accessToken).header.alg).toBe('HS256');
      expect(decode(refreshToken).header.alg).toBe('HS256');
    });

    it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])(
      'fails with a clear message when %s is empty',
      async (name) => {
        const { service } = setup({ [name]: '' });

        await expect(service.issueTokens(USER_ID)).rejects.toThrow(
          `${name} is not set`,
        );
      },
    );
  });

  describe('verifyAccessToken', () => {
    it('returns the id of the user the token was issued to', async () => {
      const { service } = setup();
      const { accessToken } = await service.issueTokens(USER_ID);

      await expect(service.verifyAccessToken(accessToken)).resolves.toBe(
        USER_ID,
      );
    });

    it('refuses the refresh token', async () => {
      const { service } = setup();
      const { refreshToken } = await service.issueTokens(USER_ID);

      await expect(service.verifyAccessToken(refreshToken)).rejects.toThrow();
    });

    it('refuses a token signed with another secret', async () => {
      const { jwt, service } = setup();
      const forged = await jwt.signAsync(
        { sub: USER_ID },
        { secret: 'a-secret-that-is-not-ours', expiresIn: 60 },
      );

      await expect(service.verifyAccessToken(forged)).rejects.toThrow();
    });

    it('refuses an expired token', async () => {
      const { jwt, service } = setup();
      const expired = await jwt.signAsync(
        { sub: USER_ID },
        { secret: ACCESS_SECRET, expiresIn: -10 },
      );

      await expect(service.verifyAccessToken(expired)).rejects.toThrow(
        /expired/i,
      );
    });

    it('refuses a token that names no user', async () => {
      const { jwt, service } = setup();
      const noUser = await jwt.signAsync(
        {},
        { secret: ACCESS_SECRET, expiresIn: 60 },
      );

      await expect(service.verifyAccessToken(noUser)).rejects.toThrow(
        'The token does not name a user',
      );
    });

    it('refuses a token that is not signed (alg none)', async () => {
      const { service } = setup();
      const part = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: USER_ID })}.`;

      await expect(service.verifyAccessToken(unsigned)).rejects.toThrow();
    });

    it('refuses text that is not a token', async () => {
      const { service } = setup();

      await expect(service.verifyAccessToken('not-a-token')).rejects.toThrow();
    });

    it('fails when the access secret is not set, instead of accepting every token', async () => {
      const { jwt, service } = setup({ JWT_ACCESS_SECRET: '' });
      const token = await jwt.signAsync(
        { sub: USER_ID },
        { secret: ACCESS_SECRET, expiresIn: 60 },
      );

      await expect(service.verifyAccessToken(token)).rejects.toThrow(
        'JWT_ACCESS_SECRET is not set',
      );
    });
  });
});
