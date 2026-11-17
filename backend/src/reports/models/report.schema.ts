import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';
import { User } from '../../users/models/user.schema';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportTargetType } from '../enums/report-target-type.enum';
import { REPORT_REASON_MAX_LENGTH } from '../reports.constants';

/**
 * A user's report of a post, a comment or an itinerary (GEN-09). An admin handles it
 * later (GEN-10), which sets the final status, who resolved it and when.
 */
@Schema({ collection: 'reports', timestamps: true })
export class Report {
  /** Set by the service from the login cookie, never by the client. */
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  reporterId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ReportTargetType),
  })
  targetType: ReportTargetType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: REPORT_REASON_MAX_LENGTH })
  reason: string;

  // Required as well as defaulted: an explicit null is refused here too.
  @Prop({
    type: String,
    required: true,
    enum: Object.values(ReportStatus),
    default: ReportStatus.Open,
    index: true,
  })
  status: ReportStatus;

  /** GEN-10: the admin who resolved the report. Empty while it is open. */
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  resolvedBy?: Types.ObjectId;

  /** GEN-10: when the report was resolved, in UTC. Empty while it is open. */
  @Prop({ type: Date })
  resolvedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);

/** "At most once per item" (GEN-09): one report per user and target. */
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);

/**
 * GEN-10: the reports of one item. Hiding or deleting it resolves its other
 * open reports in one update filtered on this target.
 */
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
