import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { AuthTokenType } from '../enums/auth-token-type.enum';

/**
 * A one-time token sent by email (ACC-02 email verification, ACC-07 password
 * reset). Only the SHA-256 hash of the token is stored: the token itself is
 * in the email alone. It never leaves the API.
 */
@Schema({ collection: 'auth_tokens', timestamps: true })
export class AuthToken {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AuthTokenType), required: true })
  type: AuthTokenType;

  /** SHA-256 of the token, in hex. Never the token itself. */
  @Prop({ type: String, required: true })
  tokenHash: string;

  /** Past it the token is refused, and the TTL index deletes the document. */
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type AuthTokenDocument = HydratedDocument<AuthToken>;
export const AuthTokenSchema = SchemaFactory.createForClass(AuthToken);
// A token is found by its hash, and two tokens never share one.
AuthTokenSchema.index({ tokenHash: 1 }, { unique: true });
// One live token per user and type: a new one replaces the old one.
AuthTokenSchema.index({ userId: 1, type: 1 }, { unique: true });
// `expireAfterSeconds: 0` deletes a token when `expiresAt` passes.
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
