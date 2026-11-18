import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { EnvironmentVariables } from '../config/env.validation';
import { AuthCookiesService } from './auth-cookies.service';

const defaults: Partial<EnvironmentVariables> = {
  ACCESS_TOKEN_MINUTES: 10,
  SESSION_INACTIVITY_MINUTES: 30,
  COOKIE_SECURE: true,
  COOKIE_SAME_SITE: 'lax',
};

function setup(overrides: Partial<EnvironmentVariables> = {}) {
  const values: Partial<EnvironmentVariables> = { ...defaults, ...overrides };
  const config = {
    get: (name: keyof EnvironmentVariables) => values[name],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const response = { cookie: jest.fn(), clearCookie: jest.fn() };

  return {
    service: new AuthCookiesService(config),
    response,
    asResponse: response as unknown as Response,
  };
}

describe('AuthCookiesService', () => {
  const tokens = { accessToken: 'access.jwt', refreshToken: 'refresh.jwt' };

  it('sets both tokens as httpOnly, Secure, SameSite cookies', () => {
    const { service, response, asResponse } = setup();

    service.setAuthCookies(asResponse, tokens);

    expect(response.cookie).toHaveBeenCalledTimes(2);
    expect(response.cookie).toHaveBeenCalledWith('access_token', 'access.jwt', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    expect(response.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh.jwt',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 30 * 60 * 1000,
      },
    );
  });

  it('follows the environment settings', () => {
    const { service, response, asResponse } = setup({
      ACCESS_TOKEN_MINUTES: 5,
      SESSION_INACTIVITY_MINUTES: 45,
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'strict',
    });

    service.setAuthCookies(asResponse, tokens);

    expect(response.cookie).toHaveBeenCalledWith(
      'access_token',
      'access.jwt',
      expect.objectContaining({
        secure: false,
        sameSite: 'strict',
        httpOnly: true,
        maxAge: 5 * 60 * 1000,
      }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh.jwt',
      expect.objectContaining({
        secure: false,
        sameSite: 'strict',
        httpOnly: true,
        maxAge: 45 * 60 * 1000,
      }),
    );
  });

  it('clears both cookies with the same options they were set with', () => {
    const { service, response, asResponse } = setup();

    service.clearAuthCookies(asResponse);

    expect(response.clearCookie).toHaveBeenCalledTimes(2);
    expect(response.clearCookie).toHaveBeenCalledWith('access_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/auth',
    });
  });

  it.each(
    [true, false].flatMap((secure) =>
      (['lax', 'strict', 'none'] as const).map(
        (sameSite) => [secure, sameSite] as const,
      ),
    ),
  )(
    'keeps both cookies httpOnly, and clears them with the options they were set with, for COOKIE_SECURE=%p and COOKIE_SAME_SITE=%p (ACC-19)',
    (secure, sameSite) => {
      const { service, response, asResponse } = setup({
        COOKIE_SECURE: secure,
        COOKIE_SAME_SITE: sameSite,
      });

      service.setAuthCookies(asResponse, tokens);
      service.clearAuthCookies(asResponse);

      const set = response.cookie.mock.calls as [string, string, object][];
      const cleared = response.clearCookie.mock.calls as [string, object][];
      expect(set).toHaveLength(2);
      expect(cleared).toHaveLength(2);
      for (const [name, , options] of set) {
        expect(options).toMatchObject({ httpOnly: true, secure, sameSite });
        // The browser keeps a cookie unless it is cleared with the same
        // options (all of them but the lifetime).
        const { maxAge: _lifetime, ...withoutLifetime } = options as {
          maxAge: number;
        };
        expect(cleared).toContainEqual([name, withoutLifetime]);
      }
    },
  );

  describe('reading the tokens of a request', () => {
    const requestWith = (cookies: unknown) =>
      ({ cookies }) as unknown as Request;

    it('reads the access cookie and the refresh cookie', () => {
      const { service } = setup();
      const request = requestWith({
        access_token: 'access.jwt',
        refresh_token: 'refresh.jwt',
      });

      expect(service.readAccessToken(request)).toBe('access.jwt');
      expect(service.readRefreshToken(request)).toBe('refresh.jwt');
    });

    it('does not mix the two up', () => {
      const { service } = setup();

      expect(
        service.readAccessToken(requestWith({ refresh_token: 'refresh.jwt' })),
      ).toBeUndefined();
      expect(
        service.readRefreshToken(requestWith({ access_token: 'access.jwt' })),
      ).toBeUndefined();
    });

    it.each([
      ['no cookie parser', undefined],
      ['no cookies', {}],
      ['a cookie parser that gave null', null],
      ['an empty cookie', { access_token: '', refresh_token: '' }],
      [
        'a cookie that is not a text',
        { access_token: { a: 1 }, refresh_token: ['x'] },
      ],
    ])('answers undefined for %s', (_name, cookies) => {
      const { service } = setup();
      const request = requestWith(cookies);

      expect(service.readAccessToken(request)).toBeUndefined();
      expect(service.readRefreshToken(request)).toBeUndefined();
    });
  });
});
