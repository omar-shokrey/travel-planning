import { Mongoose, Types } from 'mongoose';
import { AUDIT_DETAILS_MAX_LENGTH } from '../audit.constants';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditTargetType } from '../enums/audit-target-type.enum';
import { AuditLog, AuditLogSchema } from './audit-log.schema';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const AuditLogModel = mongoose.model(AuditLog.name, AuditLogSchema);

const valid = {
  adminId: new Types.ObjectId(),
  action: AuditAction.ResetPassword,
  targetType: AuditTargetType.User,
  targetId: new Types.ObjectId().toString(),
};

const invalidFields = (data: Record<string, unknown>): Promise<string[]> =>
  new AuditLogModel(data).validate().then(
    () => [],
    (error: { errors: Record<string, unknown> }) =>
      Object.keys(error.errors).sort(),
  );

describe('AuditLog model', () => {
  it('accepts a record with an admin, an action and a target', async () => {
    expect(await invalidFields(valid)).toEqual([]);
  });

  it('accepts a short note', async () => {
    expect(
      await invalidFields({ ...valid, details: 'hotel_moderator of hotel x' }),
    ).toEqual([]);
  });

  it.each(['adminId', 'action', 'targetType', 'targetId'])(
    'requires %s',
    async (field) => {
      expect(await invalidFields({ ...valid, [field]: undefined })).toContain(
        field,
      );
    },
  );

  it('rejects an action or a target type that does not exist', async () => {
    expect(await invalidFields({ ...valid, action: 'drop_database' })).toEqual([
      'action',
    ]);
    expect(await invalidFields({ ...valid, targetType: 'airport' })).toEqual([
      'targetType',
    ]);
  });

  it('rejects a note longer than the limit', async () => {
    const details = 'a'.repeat(AUDIT_DETAILS_MAX_LENGTH + 1);

    expect(await invalidFields({ ...valid, details })).toEqual(['details']);
  });

  it('stores the collection as audit_logs', () => {
    expect(AuditLogModel.collection.collectionName).toBe('audit_logs');
  });

  it('keeps a creation time and no update time (append-only)', () => {
    expect(AuditLogSchema.path('createdAt')).toBeDefined();
    expect(AuditLogSchema.path('updatedAt')).toBeUndefined();
  });

  it.each([
    { createdAt: -1, _id: -1 },
    { adminId: 1, createdAt: -1 },
    { action: 1, createdAt: -1 },
    { targetType: 1, targetId: 1, createdAt: -1 },
  ])('indexes the list by %o', (fields) => {
    expect(AuditLogSchema.indexes()).toContainEqual([
      fields,
      expect.anything(),
    ]);
  });
});
