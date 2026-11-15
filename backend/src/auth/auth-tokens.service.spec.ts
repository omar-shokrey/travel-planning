import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthTokensService } from './auth-tokens.service';

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const SESSION_ID = '6740f1c2a4b5c6d7e8f90abc';
const ACCESS_SECRET = 'access-secret-for-the-unit-tests';
const REFRESH_SECRET = 'refresh-secret-for-the-unit-tests';

interface DecodedToken {
  header: { alg: string };
  payload: {
    sub?: string;
    sid?: string;
    jti?: string;
    iat: number;
    exp: number;
  };
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

      const { accessToken, refreshToken } = await service.issueTokens(
        USER_ID,
        SESSION_ID,
      );

      expect(decode(accessToken).payload.sub).toBe(USER_ID);
      expect(decode(refreshToken).payload.sub).toBe(USER_ID);
      expect(accessToken).not.toBe(refreshToken);
    });

    it('names the session in both tokens', async () => {
      const { service, decode } = setup();

      const { accessToken, refreshToken } = await service.issueTokens(
        USER_ID,
        SESSION_ID,
      );

      expect(decode(accessToken).payload.sid).toBe(SESSION_ID);
      expect(decode(refreshToken).payload.sid).toBe(SESSION_ID);
    });

    it('carries nothing but the user, the session and the times', async () => {
      const { service, decode } = setup();

      const { accessToken } = await service.issueTokens(USER_ID, SESSION_ID);

      expect(Object.keys(decode(accessToken).payload).sort()).toEqual([
        'exp',
        'iat',
        'sid',
        'sub',
      ]);
    });

    it('gives the refresh token a random id, so two are never the same text', async () => {
      const { service, decode } = setup();

      const first = await service.issueTokens(USER_ID, SESSION_ID);
      const second = await service.issueTokens(USER_ID, SESSION_ID);

      // Made in the same second, for the same session: only the id differs.
      expect(decode(first.refreshToken).payload.jti).toEqual(
        expect.any(String),
      );
      expect(first.refreshToken).not.toBe(second.refreshToken);
    });

    it('makes the access token last ACCESS_TOKEN_MINUTES', async () => {
      const { service, decode } = setup({ ACCESS_TOKEN_MINUTES: 7 });

      const { accessToken } = await service.issueTokens(USER_ID, SESSION_ID);

      const { iat, exp } = decode(accessToken).payload;
      expect(exp - iat).toBe(7 * 60);
    });

    it('makes the refresh token last SESSION_INACTIVITY_MINUTES', async () => {
      const { service, decode } = setup({ SESSION_INACTIVITY_MINUTES: 45 });

      const { refreshToken } = await service.issueTokens(USER_ID, SESSION_ID);

      const { iat, exp } = decode(refreshToken).payload;
      expect(exp - iat).toBe(45 * 60);
    });

    it('signs each token with its own secret and with HS256', async () => {
      const { jwt, service, decode } = setup();

      const { accessToken, refreshToken } = await service.issueTokens(
        USER_ID,
        SESSION_ID,
      );

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

        await expect(service.issueTokens(USER_ID, SESSION_ID)).rejects.toThrow(
          `${name} is not set`,
        );
      },
    );
  });

  describe('verifyAccessToken', () => {
    it('returns the user and the session the token was issued for', async () => {
      const { service } = setup();
      const { accessToken } = await service.issueTokens(USER_ID, SESSION_ID);

      await expect(service.verifyAccessToken(accessToken)).resolves.toEqual({
        userId: USER_ID,
        sessionId: SESSION_ID,
      });
    });

    it('refuses the refresh token', async () => {
      const { service } = setup();
      const { refreshToken } = await service.issueTokens(USER_ID, SESSION_ID);

      await expect(service.verifyAccessToken(refreshToken)).rejects.toThrow();
    });

    it('refuses a token signed with another secret', async () => {
      const { jwt, service } = setup();
      const forged = await jwt.signAsync(
        { sub: USER_ID, sid: SESSION_ID },
        { secret: 'a-secret-that-is-not-ours', expiresIn: 60 },
      );

      await expect(service.verifyAccessToken(forged)).rejects.toThrow();
    });

    it('refuses an expired token', async () => {
      const { jwt, service } = setup();
      const expired = await jwt.signAsync(
        { sub: USER_ID, sid: SESSION_ID },
        { secret: ACCESS_SECRET, expiresIn: -10 },
      );

      await expect(service.verifyAccessToken(expired)).rejects.toThrow(
        /expired/i,
      );
    });

    it.each([
      ['no user', {}, 'The token does not name a user'],
      [
        'no user, only a session',
        { sid: SESSION_ID },
        'The token does not name a user',
      ],
      [
        'a user id that is not an id',
        { sub: 'not-an-id', sid: SESSION_ID },
        'The token does not name a user',
      ],
      [
        'no session (a token from before ACC-06)',
        { sub: USER_ID },
        'The token does not name a session',
      ],
      [
        'a session id that is not an id',
        { sub: USER_ID, sid: { $ne: null } },
        'The token does not name a session',
      ],
      [
        'a session id of the wrong length',
        { sub: USER_ID, sid: '6740f1c2a4b5' },
        'The token does not name a session',
      ],
    ])('refuses a token that names %s', async (_name, payload, message) => {
      const { jwt, service } = setup();
      const token = await jwt.signAsync(payload, {
        secret: ACCESS_SECRET,
        expiresIn: 60,
      });

      await expect(service.verifyAccessToken(token)).rejects.toThrow(message);
    });

    it('refuses a token that is not signed (alg none)', async () => {
      const { service } = setup();
      const part = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: USER_ID, sid: SESSION_ID })}.`;

      await expect(service.verifyAccessToken(unsigned)).rejects.toThrow();
    });

    it('refuses text that is not a token', async () => {
      const { service } = setup();

      await expect(service.verifyAccessToken('not-a-token')).rejects.toThrow();
    });

    it('fails when the access secret is not set, instead of accepting every token', async () => {
      const { jwt, service } = setup({ JWT_ACCESS_SECRET: '' });
      const token = await jwt.signAsync(
        { sub: USER_ID, sid: SESSION_ID },
        { secret: ACCESS_SECRET, expiresIn: 60 },
      );

      await expect(service.verifyAccessToken(token)).rejects.toThrow(
        'JWT_ACCESS_SECRET is not set',
      );
    });
  });

  describe('verifyRefreshToken', () => {
    it('returns the user and the session the token was issued for', async () => {
      const { service } = setup();
      const { refreshToken } = await service.issueTokens(USER_ID, SESSION_ID);

      await expect(service.verifyRefreshToken(refreshToken)).resolves.toEqual({
        userId: USER_ID,
        sessionId: SESSION_ID,
      });
    });

    it('refuses the access token', async () => {
      const { service } = setup();
      const { accessToken } = await service.issueTokens(USER_ID, SESSION_ID);

      await expect(service.verifyRefreshToken(accessToken)).rejects.toThrow();
    });

    it('refuses an expired token', async () => {
      const { jwt, service } = setup();
      const expired = await jwt.signAsync(
        { sub: USER_ID, sid: SESSION_ID },
        { secret: REFRESH_SECRET, expiresIn: -10 },
      );

      await expect(service.verifyRefreshToken(expired)).rejects.toThrow(
        /expired/i,
      );
    });

    it('refuses a token that names no session', async () => {
      const { jwt, service } = setup();
      const token = await jwt.signAsync(
        { sub: USER_ID },
        { secret: REFRESH_SECRET, expiresIn: 60 },
      );

      await expect(service.verifyRefreshToken(token)).rejects.toThrow(
        'The token does not name a session',
      );
    });

    it('fails when the refresh secret is not set', async () => {
      const { jwt, service } = setup({ JWT_REFRESH_SECRET: '' });
      const token = await jwt.signAsync(
        { sub: USER_ID, sid: SESSION_ID },
        { secret: REFRESH_SECRET, expiresIn: 60 },
      );

      await expect(service.verifyRefreshToken(token)).rejects.toThrow(
        'JWT_REFRESH_SECRET is not set',
      );
    });
  });

  describe('readClaims (for logout)', () => {
    it('reads a valid token of either kind', async () => {
      const { service } = setup();
      const { accessToken, refreshToken } = await service.issueTokens(
        USER_ID,
        SESSION_ID,
      );
      const claims = { userId: USER_ID, sessionId: SESSION_ID };

      await expect(service.readClaims(accessToken, 'access')).resolves.toEqual(
        claims,
      );
      await expect(
        service.readClaims(refreshToken, 'refresh'),
      ).resolves.toEqual(claims);
    });

    it.each(['access', 'refresh'] as const)(
      'reads an expired %s token, because its owner may still log out',
      async (kind) => {
        const { jwt, service } = setup();
        const expired = await jwt.signAsync(
          { sub: USER_ID, sid: SESSION_ID },
          {
            secret: kind === 'access' ? ACCESS_SECRET : REFRESH_SECRET,
            expiresIn: -10,
          },
        );

        await expect(service.readClaims(expired, kind)).resolves.toEqual({
          userId: USER_ID,
          sessionId: SESSION_ID,
        });
      },
    );

    it('answers null for a token signed with another secret', async () => {
      const { jwt, service } = setup();
      const forged = await jwt.signAsync(
        { sub: USER_ID, sid: SESSION_ID },
        { secret: 'a-secret-that-is-not-ours', expiresIn: 60 },
      );

      await expect(service.readClaims(forged, 'access')).resolves.toBeNull();
    });

    it('answers null for the token of the other kind', async () => {
      const { service } = setup();
      const { accessToken, refreshToken } = await service.issueTokens(
        USER_ID,
        SESSION_ID,
      );

      await expect(
        service.readClaims(accessToken, 'refresh'),
      ).resolves.toBeNull();
      await expect(
        service.readClaims(refreshToken, 'access'),
      ).resolves.toBeNull();
    });

    it('answers null for text that is not a token, and for a token with no session', async () => {
      const { jwt, service } = setup();
      const noSession = await jwt.signAsync(
        { sub: USER_ID },
        { secret: ACCESS_SECRET, expiresIn: 60 },
      );

      await expect(
        service.readClaims('not-a-token', 'access'),
      ).resolves.toBeNull();
      await expect(service.readClaims(noSession, 'access')).resolves.toBeNull();
    });
  });

  describe('hashToken', () => {
    it('gives the SHA-256 of the token as 64 hex characters', () => {
      const { service } = setup();

      expect(service.hashToken('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('gives the same text for the same token and another for another token', () => {
      const { service } = setup();

      expect(service.hashToken('one')).toBe(service.hashToken('one'));
      expect(service.hashToken('one')).not.toBe(service.hashToken('two'));
    });

    it('does not contain the token', () => {
      const { service } = setup();
      const token = 'a-refresh-token-that-must-not-be-stored';

      expect(service.hashToken(token)).not.toContain(token);
    });
  });
});
