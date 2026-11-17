/**
 * The life of a report. GEN-09 creates it `open`; GEN-10 (admin moderation)
 * moves it to `dismissed`, `hidden` or `deleted`.
 */
export enum ReportStatus {
  Open = 'open',
  Dismissed = 'dismissed',
  Hidden = 'hidden',
  Deleted = 'deleted',
}
