import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import type { Model, QueryFilter, Types } from 'mongoose';
import { AuthTokenType } from './enums/auth-token-type.enum';
import { AuthToken } from './models/auth-token.schema';

/** How many random bytes a token has: 256 bits, 43 characters in base64url. */
export const AUTH_TOKEN_BYTES = 32;

const MONGO_DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === MONGO_DUPLICATE_KEY;

/** A new token: 32 random bytes in base64url (43 characters). */
const newToken = (): string =>
  randomBytes(AUTH_TOKEN_BYTES).toString('base64url');

/** The SHA-256 of a token, in hex: what `auth_tokens` stores and looks up. */
export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * ACC-02, ACC-07: the one-time tokens sent by email, in `auth_tokens`. Not to
 * be mixed up with `AuthTokensService`, which signs the login JWTs.
 *
 * - A token is 32 random bytes in base64url. Only its SHA-256 hash is stored,
 *   so a copy of the database holds no usable link. The token is returned to
 *   the caller, which puts it in the email; it is never logged or returned by
 *   a route.
 * - One live token per user and type: issuing a new one replaces the old one
 *   in one atomic upsert, so the old link stops working at once.
 *   `issueUnlessRecent` does the same unless the last one is too recent.
 * - Consuming is one atomic `findOneAndDelete` on the type, the hash and an
 *   expiry in the future: a token works once, and of two uses at the same
 *   moment only one gets the user.
 * - An expired token is refused at once, and the TTL index deletes it later.
 */
@Injectable()
export class AuthTokenStoreService {
  constructor(
    @InjectModel(AuthToken.name) private readonly tokens: Model<AuthToken>,
  ) {}

  /**
   * Creates the token of `type` for the user, valid for `lifetimeMs`, and
   * returns it. An older token of the same user and type stops working.
   */
  async issue(
    userId: Types.ObjectId,
    type: AuthTokenType,
    lifetimeMs: number,
    now: Date = new Date(),
  ): Promise<string> {
    const token = newToken();
    const replace = () => this.write({ userId, type }, token, lifetimeMs, now);
    try {
      await replace();
    } catch (error) {
      // Two first tokens of the same user at the same moment both try to
      // insert; the unique (userId, type) index refuses the second. Run again,
      // it now finds the document and replaces it.
      if (!isDuplicateKey(error)) {
        throw error;
      }
      await replace();
    }
    return token;
  }

  /**
   * Like `issue`, unless the user's token of `type` was issued less than
   * `minIntervalMs` ago: then nothing changes and it returns `null`. One
   * atomic step: the upsert only matches a token old enough to replace; when
   * a newer one exists, its insert hits the unique (userId, type) index. So
   * requests at the same moment never send two links.
   */
  async issueUnlessRecent(
    userId: Types.ObjectId,
    type: AuthTokenType,
    lifetimeMs: number,
    minIntervalMs: number,
    now: Date = new Date(),
  ): Promise<string | null> {
    const token = newToken();
    try {
      await this.write(
        {
          userId,
          type,
          updatedAt: { $lte: new Date(now.getTime() - minIntervalMs) },
        },
        token,
        lifetimeMs,
        now,
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        return null;
      }
      throw error;
    }
    return token;
  }

  /** The one upsert that stores a token's hash and expiry. */
  private async write(
    filter: QueryFilter<AuthToken>,
    token: string,
    lifetimeMs: number,
    now: Date,
  ): Promise<void> {
    await this.tokens
      .findOneAndUpdate(
        filter,
        {
          $set: {
            tokenHash: hashAuthToken(token),
            expiresAt: new Date(now.getTime() + lifetimeMs),
          },
        },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /**
   * Uses the token: deletes it and returns its user, or `null` when it is
   * unknown, of another type, expired, already used or replaced.
   */
  async consume(
    token: string,
    type: AuthTokenType,
    now: Date = new Date(),
  ): Promise<Types.ObjectId | null> {
    const used = await this.tokens
      .findOneAndDelete({
        type,
        tokenHash: hashAuthToken(token),
        expiresAt: { $gt: now },
      })
      .select('userId')
      .lean()
      .exec();
    return used?.userId ?? null;
  }
}
