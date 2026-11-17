import { ReportStatus } from './report-status.enum';

/**
 * GEN-10: how an admin resolves an open report. Dismissing leaves the content
 * as it is; hiding sets its `moderation` to hidden; deleting removes it.
 */
export enum ReportAction {
  Dismiss = 'dismiss',
  Hide = 'hide',
  Delete = 'delete',
}

/** The status a report gets for each action. */
export const REPORT_ACTION_STATUS: Record<ReportAction, ReportStatus> = {
  [ReportAction.Dismiss]: ReportStatus.Dismissed,
  [ReportAction.Hide]: ReportStatus.Hidden,
  [ReportAction.Delete]: ReportStatus.Deleted,
};
