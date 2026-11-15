import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';

/**
 * One login of one user on one browser (ACC-06). A user has many sessions.
 * The session is what logout revokes and what the 30-minute inactivity limit
 * is counted on. It never leaves the API.
 */
@Schema({ collection: 'sessions' })
export class Session {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** SHA-256 of the refresh token that is valid now. Never the token itself. */
  @Prop({ required: true })
  refreshTokenHash: string;

  /** The last authenticated request, or the login or refresh that started the session. */
  @Prop({ required: true })
  lastActivityAt: Date;

  /** `lastActivityAt` plus the inactivity limit. Past it the session is over and the TTL index deletes it. */
  @Prop({ required: true })
  expiresAt: Date;

  /** Set by logout. A revoked session is refused even while it has not expired. */
  @Prop()
  revokedAt?: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ userId: 1 });
// `expireAfterSeconds: 0` deletes a session when `expiresAt` passes.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
