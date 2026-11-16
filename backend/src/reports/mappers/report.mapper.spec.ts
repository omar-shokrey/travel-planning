import { Types } from 'mongoose';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportTargetType } from '../enums/report-target-type.enum';
import { toReportResponse } from './report.mapper';

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
