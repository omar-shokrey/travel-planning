import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../common/constants/cookies';
import type { EnvironmentVariables } from '../config/env.validation';

const MINUTE_IN_MS = 60_000;

/**
 * The access cookie goes to every path, so the frontend's proxy.ts can read
 * it on page requests.
 */
export const ACCESS_COOKIE_PATH = '/';
/** The refresh cookie goes only to the auth routes (refresh and logout). */
export const REFRESH_COOKIE_PATH = '/api/auth';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Sets and clears the two authentication cookies (ACC-19). The tokens never
 * reach JavaScript: both cookies are httpOnly.
 *
 * The refresh cookie lasts SESSION_INACTIVITY_MINUTES and is replaced every time
 * tokens are issued, so a session that stays idle that long expires (ACC-06).
 * Logout clears both cookies.
 */
@Injectable()
export class AuthCookiesService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  setAuthCookies(response: Response, tokens: AuthTokens): void {
    response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...this.options(ACCESS_COOKIE_PATH),
      maxAge: this.minutes('ACCESS_TOKEN_MINUTES') * MINUTE_IN_MS,
    });
    response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...this.options(REFRESH_COOKIE_PATH),
      maxAge: this.minutes('SESSION_INACTIVITY_MINUTES') * MINUTE_IN_MS,
    });
  }

  /** The access token the request carries, or `undefined`. */
  readAccessToken(request: Request): string | undefined {
    return this.readCookie(request, ACCESS_TOKEN_COOKIE);
  }

  /** The refresh token the request carries, or `undefined`. The browser sends it only to `/api/auth`. */
  readRefreshToken(request: Request): string | undefined {
    return this.readCookie(request, REFRESH_TOKEN_COOKIE);
  }

  /** The options must match the ones used to set the cookies, or the browser keeps them. */
  clearAuthCookies(response: Response): void {
    response.clearCookie(ACCESS_TOKEN_COOKIE, this.options(ACCESS_COOKIE_PATH));
    response.clearCookie(
      REFRESH_TOKEN_COOKIE,
      this.options(REFRESH_COOKIE_PATH),
    );
  }

  /** A cookie is a text. Anything else, or an empty one, counts as no cookie. */
  private readCookie(request: Request, name: string): string | undefined {
    const cookies: unknown = request.cookies;
    if (typeof cookies !== 'object' || cookies === null) {
      return undefined;
    }
    const value = (cookies as Record<string, unknown>)[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  private options(path: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: this.config.get('COOKIE_SAME_SITE', { infer: true }),
      path,
    };
  }

  private minutes(
    name: 'ACCESS_TOKEN_MINUTES' | 'SESSION_INACTIVITY_MINUTES',
  ): number {
    return this.config.get(name, { infer: true });
  }
}
