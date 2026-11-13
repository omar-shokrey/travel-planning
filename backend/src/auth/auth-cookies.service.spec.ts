import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
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
});
