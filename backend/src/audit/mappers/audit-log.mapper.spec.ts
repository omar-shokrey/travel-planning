import { Types } from 'mongoose';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditTargetType } from '../enums/audit-target-type.enum';
import { toAuditLogResponse, type AuditLogSource } from './audit-log.mapper';

const source: AuditLogSource = {
  _id: new Types.ObjectId('6741c0ffee0123456789abcd'),
  adminId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90001'),
  action: AuditAction.CreateModerator,
  targetType: AuditTargetType.User,
  targetId: '6740f1c2a4b5c6d7e8f90123',
  details: 'hotel_moderator of hotel 6740f1c2a4b5c6d7e8f90abc',
  createdAt: new Date('2026-11-16T11:30:00.000+02:00'),
};

describe('toAuditLogResponse', () => {
  it('returns the record with string ids and a UTC date', () => {
    expect(toAuditLogResponse(source)).toEqual({
      id: '6741c0ffee0123456789abcd',
      adminId: '6740f1c2a4b5c6d7e8f90001',
      action: 'create_moderator',
      targetType: 'user',
      targetId: '6740f1c2a4b5c6d7e8f90123',
      details: 'hotel_moderator of hotel 6740f1c2a4b5c6d7e8f90abc',
      createdAt: '2026-11-16T09:30:00.000Z',
    });
  });

  it('returns null for a record with no note', () => {
    expect(
      toAuditLogResponse({ ...source, details: undefined }).details,
    ).toBeNull();
  });

  it('returns only the public fields', () => {
    const stored = { ...source, __v: 0, extra: 'not public' };

    expect(Object.keys(toAuditLogResponse(stored)).sort()).toEqual([
      'action',
      'adminId',
      'createdAt',
      'details',
      'id',
      'targetId',
      'targetType',
    ]);
  });
});
