import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { Session } from './models/session.schema';

const MILLISECONDS_PER_MINUTE = 60_000;

/** What a login stores for its session. */
export interface NewSession {
  /** Made before the tokens are signed, because both tokens carry it. */
  id: Types.ObjectId;
  userId: Types.ObjectId;
  refreshTokenHash: string;
  now: Date;
}

/** A refresh: the session gets a new refresh token in place of the one it holds. */
export interface RefreshRotation {
  sessionId: string;
  userId: string;
  /** Hash of the refresh token the caller sent. It must be the one the session holds. */
  currentHash: string;
  newHash: string;
  now: Date;
}

/**
 * The sessions behind the two login tokens (ACC-06). The database access of
 * logout, refresh and the 30-minute inactivity limit is here; what each one
 * means for the caller is in AuthService and JwtAuthGuard.
 *
 * Every method is one atomic update, so two requests at once cannot both win.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly config: ConfigService,
  ) {}

  async create(input: NewSession): Promise<void> {
    await this.sessions.create({
      _id: input.id,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      lastActivityAt: input.now,
      expiresAt: this.expiryFrom(input.now),
    });
  }

  /**
   * Counts an authenticated request as activity: moves the end of the session
   * to the inactivity limit from `now`. It answers `false`, and changes
   * nothing, when the session does not exist, belongs to another user, was
   * revoked, or has already been idle for the whole limit.
   */
  async touch(sessionId: string, userId: string, now: Date): Promise<boolean> {
    const result = await this.sessions
      .updateOne(this.liveSession(sessionId, userId, now), {
        $set: { lastActivityAt: now, expiresAt: this.expiryFrom(now) },
      })
      .exec();
    return result.matchedCount === 1;
  }

  /**
   * Swaps the stored refresh token hash for the new one, and counts the
   * refresh as activity. It answers `false` when the session is revoked,
   * expired, unknown, or holds another refresh token than the one the caller
   * sent. That last case is what makes a refresh token work once: of two
   * refreshes with the same token, only one finds the hash it expects.
   */
  async rotate(input: RefreshRotation): Promise<boolean> {
    const result = await this.sessions
      .updateOne(
        {
          ...this.liveSession(input.sessionId, input.userId, input.now),
          refreshTokenHash: input.currentHash,
        },
        {
          $set: {
            refreshTokenHash: input.newHash,
            lastActivityAt: input.now,
            expiresAt: this.expiryFrom(input.now),
          },
        },
      )
      .exec();
    return result.matchedCount === 1;
  }

  /**
   * Revokes the session (logout). Revoking a session that is already revoked,
   * or that is gone, changes nothing, so logging out twice is harmless.
   */
  async revoke(sessionId: string, userId: string, now: Date): Promise<void> {
    await this.sessions
      .updateOne(
        { _id: sessionId, userId, revokedAt: null },
        { $set: { revokedAt: now } },
      )
      .exec();
  }

  /** A session of this user that is not revoked and has not run out. */
  private liveSession(sessionId: string, userId: string, now: Date) {
    return {
      _id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { $gt: now },
    };
  }

  private expiryFrom(moment: Date): Date {
    const minutes = this.config.getOrThrow<number>(
      'SESSION_INACTIVITY_MINUTES',
    );
    return new Date(moment.getTime() + minutes * MILLISECONDS_PER_MINUTE);
  }
}
