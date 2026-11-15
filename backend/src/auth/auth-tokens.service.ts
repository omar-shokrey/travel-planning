import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthTokens } from './auth-cookies.service';

const SECONDS_PER_MINUTE = 60;
/** The only algorithm accepted, so a token can never name a weaker one. */
const ALGORITHM = 'HS256';
/** An ObjectId as text. Both ids in a token must look like this before they reach a query, or a bad one would end in a 500. */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** What both tokens carry: the user they were issued to and the session they belong to. */
interface TokenPayload {
  sub: string;
  sid: string;
}

/** Who a token was issued to, and in which session (ACC-06). */
export interface TokenClaims {
  userId: string;
  sessionId: string;
}

type SecretName = 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET';
type LifetimeName = 'ACCESS_TOKEN_MINUTES' | 'SESSION_INACTIVITY_MINUTES';

/** Which of the two tokens a call is about. */
export type TokenKind = 'access' | 'refresh';

const SECRETS: Record<TokenKind, SecretName> = {
  access: 'JWT_ACCESS_SECRET',
  refresh: 'JWT_REFRESH_SECRET',
};

/**
 * Signs and checks the two login tokens (ACC-04, ACC-06). The access token
 * proves who is calling and is short-lived. The refresh token lasts as long as
 * the inactivity limit and is the only thing that can get new tokens; it is
 * signed with another secret so one can never be used as the other.
 *
 * Both tokens name the session they belong to (`sid`). A valid signature is
 * not enough to be let in: the session must also still be live, which logout
 * and the inactivity limit take away.
 */
@Injectable()
export class AuthTokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issueTokens(userId: string, sessionId: string): Promise<AuthTokens> {
    const payload: TokenPayload = { sub: userId, sid: sessionId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.secret('access'),
        algorithm: ALGORITHM,
        expiresIn: this.minutes('ACCESS_TOKEN_MINUTES') * SECONDS_PER_MINUTE,
      }),
      this.jwt.signAsync(payload, {
        secret: this.secret('refresh'),
        algorithm: ALGORITHM,
        expiresIn:
          this.minutes('SESSION_INACTIVITY_MINUTES') * SECONDS_PER_MINUTE,
        // Two refresh tokens made in the same second for the same session
        // would be the same text. A random id makes every one different, so a
        // rotated token can never equal the one it replaces.
        jwtid: randomUUID(),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  /**
   * Returns the user and the session an access token was issued for. It
   * throws when the token is malformed, expired, signed with another secret,
   * or does not name both. Whether the session is still live is not checked
   * here.
   */
  verifyAccessToken(token: string): Promise<TokenClaims> {
    return this.verify(token, 'access', false);
  }

  /** The same for a refresh token. */
  verifyRefreshToken(token: string): Promise<TokenClaims> {
    return this.verify(token, 'refresh', false);
  }

  /**
   * For logout: the claims of a token we signed, even if it has expired, or
   * `null` when it is not ours. The signature still has to be right, so only
   * the holder of a real token can revoke its session; an expired one may,
   * because a user whose tokens ran out must still be able to log out.
   */
  async readClaims(
    token: string,
    kind: TokenKind,
  ): Promise<TokenClaims | null> {
    try {
      return await this.verify(token, kind, true);
    } catch {
      return null;
    }
  }

  /**
   * The text stored for a refresh token in place of the token. A leak of the
   * database must not hand out working tokens. SHA-256 is enough, because a
   * token is long and random, unlike a password.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async verify(
    token: string,
    kind: TokenKind,
    ignoreExpiration: boolean,
  ): Promise<TokenClaims> {
    const payload = await this.jwt.verifyAsync<Partial<TokenPayload>>(token, {
      secret: this.secret(kind),
      algorithms: [ALGORITHM],
      ignoreExpiration,
    });
    if (
      typeof payload.sub !== 'string' ||
      !OBJECT_ID_PATTERN.test(payload.sub)
    ) {
      throw new Error('The token does not name a user');
    }
    if (
      typeof payload.sid !== 'string' ||
      !OBJECT_ID_PATTERN.test(payload.sid)
    ) {
      throw new Error('The token does not name a session');
    }
    return { userId: payload.sub, sessionId: payload.sid };
  }

  private secret(kind: TokenKind): string {
    const name = SECRETS[kind];
    const value = this.config.get<string>(name);
    if (!value) {
      throw new Error(
        `${name} is not set. Add it to backend/.env (see .env.example).`,
      );
    }
    return value;
  }

  private minutes(name: LifetimeName): number {
    return this.config.getOrThrow<number>(name);
  }
}
