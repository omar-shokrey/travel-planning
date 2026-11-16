import { ReportStatus } from '../enums/report-status.enum';
import { ReportTargetType } from '../enums/report-target-type.enum';
import { REPORT_REASON_MAX_LENGTH } from '../reports.constants';
import { ReportSchema } from './report.schema';

describe('ReportSchema (GEN-09)', () => {
  it('has a unique index on (reporterId, targetType, targetId)', () => {
    expect(ReportSchema.indexes()).toContainEqual([
      { reporterId: 1, targetType: 1, targetId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('indexes the status for the admin list (GEN-10)', () => {
    expect(ReportSchema.path('status').options).toMatchObject({
      index: true,
      default: ReportStatus.Open,
      enum: Object.values(ReportStatus),
    });
  });

  it('limits the target type and the reason', () => {
    expect(ReportSchema.path('targetType').options).toMatchObject({
      required: true,
      enum: Object.values(ReportTargetType),
    });
    expect(ReportSchema.path('reason').options).toMatchObject({
      required: true,
      maxlength: REPORT_REASON_MAX_LENGTH,
    });
  });

  it('stores ids as ObjectIds', () => {
    expect(ReportSchema.path('reporterId').instance).toBe('ObjectId');
    expect(ReportSchema.path('targetId').instance).toBe('ObjectId');
  });

  it('records who resolved a report and when, both optional (GEN-10)', () => {
    expect(ReportSchema.path('resolvedBy').instance).toBe('ObjectId');
    expect(ReportSchema.path('resolvedBy').isRequired).toBeFalsy();
    expect(ReportSchema.path('resolvedAt').instance).toBe('Date');
    expect(ReportSchema.path('resolvedAt').isRequired).toBeFalsy();
  });

  it('indexes the reports of one item, to resolve them together (GEN-10)', () => {
    expect(ReportSchema.indexes()).toContainEqual([
      { targetType: 1, targetId: 1, status: 1 },
      expect.anything(),
    ]);
  });
});
