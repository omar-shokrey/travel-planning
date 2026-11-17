import type { Types } from 'mongoose';
import type { AdminReportResponseDto } from '../dto/admin-report-response.dto';
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

/** The fields the admin mapper reads (GEN-10). */
export type AdminReportSource = ReportSource &
  Pick<Report, 'reporterId' | 'resolvedBy' | 'resolvedAt'>;

/**
 * Turns a stored report into what an admin sees (GEN-10): the public fields,
 * the reporter, and who resolved it and when. The last two are left out while
 * the report is open.
 */
export function toAdminReportResponse(
  report: AdminReportSource,
): AdminReportResponseDto {
  return {
    ...toReportResponse(report),
    reporterId: report.reporterId.toString(),
    ...(report.resolvedBy && { resolvedBy: report.resolvedBy.toString() }),
    ...(report.resolvedAt && { resolvedAt: report.resolvedAt.toISOString() }),
  };
}
