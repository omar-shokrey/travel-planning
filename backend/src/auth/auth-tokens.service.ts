import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokens } from './auth-cookies.service';

const SECONDS_PER_MINUTE = 60;
/** The only algorithm accepted, so a token can never name a weaker one. */
const ALGORITHM = 'HS256';

/** What both tokens carry: the id of the user they were issued to. */
interface TokenPayload {
  sub: string;
}

type SecretName = 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET';
type LifetimeName = 'ACCESS_TOKEN_MINUTES' | 'SESSION_INACTIVITY_MINUTES';

/**
 * Signs and checks the two login tokens (ACC-04). The access token proves who
 * is calling and is short-lived. The refresh token lasts as long as the
 * inactivity limit; it is signed with another secret so one can never be used
 * as the other. Nothing reads the refresh token yet: refresh and logout come
 * with ACC-06.
 */
@Injectable()
export class AuthTokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issueTokens(userId: string): Promise<AuthTokens> {
    const payload: TokenPayload = { sub: userId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.secret('JWT_ACCESS_SECRET'),
        algorithm: ALGORITHM,
        expiresIn: this.minutes('ACCESS_TOKEN_MINUTES') * SECONDS_PER_MINUTE,
      }),
      this.jwt.signAsync(payload, {
        secret: this.secret('JWT_REFRESH_SECRET'),
        algorithm: ALGORITHM,
        expiresIn:
          this.minutes('SESSION_INACTIVITY_MINUTES') * SECONDS_PER_MINUTE,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  /**
   * Returns the id of the user an access token was issued to. It throws when
   * the token is malformed, expired, or signed with another secret.
   */
  async verifyAccessToken(token: string): Promise<string> {
    const payload = await this.jwt.verifyAsync<TokenPayload>(token, {
      secret: this.secret('JWT_ACCESS_SECRET'),
      algorithms: [ALGORITHM],
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new Error('The token does not name a user');
    }
    return payload.sub;
  }

  private secret(name: SecretName): string {
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
