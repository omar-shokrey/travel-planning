/**
 * The longest reason a report may have, counted after trimming. The workbook
 * sets no limit; 500 characters is enough to explain a problem and keeps one
 * request from storing a large amount of text.
 */
export const REPORT_REASON_MAX_LENGTH = 500;
