import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { AUDIT_DETAILS_MAX_LENGTH } from '../audit.constants';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditTargetType } from '../enums/audit-target-type.enum';

/**
 * One administrator action (GEN-07). The log is append-only: a record is
 * written once and never changed, so it has a creation time and no update
 * time.
 */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  /** The administrator who acted. */
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  adminId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(AuditAction) })
  action: AuditAction;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(AuditTargetType),
  })
  targetType: AuditTargetType;

  /** The id of the account, provider, report or content the action touched. */
  @Prop({ type: String, required: true })
  targetId: string;

  /** A short public note. Never a password, a hash or a token. */
  @Prop({ type: String, trim: true, maxlength: AUDIT_DETAILS_MAX_LENGTH })
  details?: string;

  // Written by Mongoose (`timestamps`). Declared only for its type.
  createdAt: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
// The list is newest first, with or without a filter.
AuditLogSchema.index({ createdAt: -1, _id: -1 });
AuditLogSchema.index({ adminId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
