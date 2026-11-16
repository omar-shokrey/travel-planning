import { Types } from 'mongoose';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportTargetType } from '../enums/report-target-type.enum';
import { toAdminReportResponse, toReportResponse } from './report.mapper';

describe('toReportResponse (GEN-09)', () => {
  const id = new Types.ObjectId();
  const targetId = new Types.ObjectId();

  it('returns the public fields with string ids and a UTC createdAt', () => {
    expect(
      toReportResponse({
        _id: id,
        targetType: ReportTargetType.Itinerary,
        targetId,
        reason: 'Offensive title',
        status: ReportStatus.Open,
        createdAt: new Date('2026-11-16T10:00:00.000Z'),
      }),
    ).toEqual({
      id: id.toString(),
      targetType: 'itinerary',
      targetId: targetId.toString(),
      reason: 'Offensive title',
      status: 'open',
      createdAt: '2026-11-16T10:00:00.000Z',
    });
  });

  it('never returns the reporter or other stored fields', () => {
    const stored = {
      _id: id,
      reporterId: new Types.ObjectId(),
      targetType: ReportTargetType.Post,
      targetId,
      reason: 'Spam',
      status: ReportStatus.Open,
      createdAt: new Date('2026-11-16T10:00:00.000Z'),
      updatedAt: new Date('2026-11-16T10:00:00.000Z'),
    };

    const response = toReportResponse(stored);

    expect(Object.keys(response).sort()).toEqual([
      'createdAt',
      'id',
      'reason',
      'status',
      'targetId',
      'targetType',
    ]);
  });
});

describe('toAdminReportResponse (GEN-10)', () => {
  const id = new Types.ObjectId();
  const targetId = new Types.ObjectId();
  const reporterId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const open = {
    _id: id,
    reporterId,
    targetType: ReportTargetType.Post,
    targetId,
    reason: 'Spam',
    status: ReportStatus.Open,
    createdAt: new Date('2026-11-16T12:00:00.000+02:00'),
    updatedAt: new Date('2026-11-16T12:00:00.000+02:00'),
  };

  it('adds the reporter to an open report and leaves out the resolution', () => {
    expect(toAdminReportResponse(open)).toEqual({
      id: id.toString(),
      targetType: 'post',
      targetId: targetId.toString(),
      reason: 'Spam',
      status: 'open',
      createdAt: '2026-11-16T10:00:00.000Z',
      reporterId: reporterId.toString(),
    });
  });

  it('adds who resolved a report and when, in UTC', () => {
    const response = toAdminReportResponse({
      ...open,
      status: ReportStatus.Hidden,
      resolvedBy: adminId,
      resolvedAt: new Date('2026-11-17T11:30:00.000+02:00'),
    });

    expect(response).toMatchObject({
      status: 'hidden',
      resolvedBy: adminId.toString(),
      resolvedAt: '2026-11-17T09:30:00.000Z',
    });
    expect(Object.keys(response)).not.toContain('updatedAt');
  });
});
