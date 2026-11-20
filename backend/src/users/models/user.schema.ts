import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { ProviderType } from '../../common/enums/provider-type.enum';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';

@Schema({ _id: false })
export class ModeratorAssignment {
  @Prop({ type: String, required: true, enum: Object.values(ProviderType) })
  providerType: ProviderType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  providerId: Types.ObjectId;
}

export const ModeratorAssignmentSchema =
  SchemaFactory.createForClass(ModeratorAssignment);

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop()
  preferredCurrency?: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(Role),
    default: Role.User,
  })
  role: Role;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(UserStatus),
    default: UserStatus.Active,
  })
  status: UserStatus;

  @Prop()
  consentAcceptedAt?: Date;

  @Prop({ default: 0, min: 0 })
  failedLoginAttempts: number;

  @Prop()
  lockedUntil?: Date;

  @Prop({ default: false })
  mustChangePassword: boolean;

  /**
   * ACC-02: false only for an account registered while email is switched on,
   * until it opens the verification link; such an account cannot book. Every
   * other account (moderators, admins, accounts made before ACC-02, accounts
   * registered while email is off) has no field or `true`: verified.
   */
  @Prop({ type: Boolean, default: true })
  emailVerified: boolean;

  @Prop()
  deactivatedAt?: Date;

  @Prop({ type: ModeratorAssignmentSchema })
  assignment?: ModeratorAssignment;

  /** Written by Mongoose (`timestamps: true`). Declared here only for the types. */
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ 'assignment.providerId': 1 }, { sparse: true });
