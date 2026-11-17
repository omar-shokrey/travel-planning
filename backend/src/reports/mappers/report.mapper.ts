import type { Types } from 'mongoose';
import type { ReportResponseDto } from '../dto/report-response.dto';
import type { Report } from '../models/report.schema';

/** The fields the mapper reads. A report document and a lean report both fit. */
export type ReportSource = Pick<
  Report,
  'targetType' | 'targetId' | 'reason' | 'status' | 'createdAt'
> & { _id: Types.ObjectId };

/**
 * Turns a stored report into what the API returns. The fields are listed one
 * by one, so the reporter id never leaves the API by accident.
 */
export function toReportResponse(report: ReportSource): ReportResponseDto {
  return {
    id: report._id.toString(),
    targetType: report.targetType,
    targetId: report.targetId.toString(),
    reason: report.reason,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
  };
}
