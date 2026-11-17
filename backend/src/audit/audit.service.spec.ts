import { Logger } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import { AUDIT_DETAILS_MAX_LENGTH } from './audit.constants';
import { AuditService } from './audit.service';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import type { AuditLog } from './models/audit-log.schema';

const ADMIN_ID = '6740f1c2a4b5c6d7e8f90001';
const TARGET_ID = '6740f1c2a4b5c6d7e8f90123';

/** A Mongoose query chain, as far as the service uses it. */
interface QueryChain {
  sort: jest.Mock<QueryChain>;
  skip: jest.Mock<QueryChain>;
  limit: jest.Mock<QueryChain>;
  exec: jest.Mock<Promise<unknown>, []>;
}

const query = (value: unknown): QueryChain => {
  const chain: QueryChain = {
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue(value),
  };
  return chain;
};

function setup() {
  const stored = [{ _id: new Types.ObjectId() }];
  const findChain = query(stored);
  const model = {
    insertMany: jest.fn().mockResolvedValue([]),
    find: jest.fn(() => findChain),
    countDocuments: jest.fn(() => query(21)),
  };
  const service = new AuditService(model as unknown as Model<AuditLog>);
  return { model, service, findChain, stored };
}

describe('AuditService', () => {
  describe('record', () => {
    it('appends one record with the admin, the action, the target and the note', async () => {
      const { model, service } = setup();

      await service.record({
        adminId: ADMIN_ID,
        action: AuditAction.CreateModerator,
        targetType: AuditTargetType.User,
        targetId: new Types.ObjectId(TARGET_ID),
        details: 'hotel_moderator of hotel x',
      });

      expect(model.insertMany).toHaveBeenCalledWith([
        {
          adminId: new Types.ObjectId(ADMIN_ID),
          action: 'create_moderator',
          targetType: 'user',
          targetId: TARGET_ID,
          details: 'hotel_moderator of hotel x',
        },
      ]);
    });

    it('cuts a note longer than the limit, so the record is still saved', async () => {
      const { model, service } = setup();

      await service.record({
        adminId: ADMIN_ID,
        action: AuditAction.DeactivateProvider,
        targetType: AuditTargetType.Airline,
        targetId: TARGET_ID,
        details: 'A'.repeat(AUDIT_DETAILS_MAX_LENGTH + 100),
      });

      const [[rows]] = model.insertMany.mock.calls as [[{ details: string }[]]];
      expect(rows[0].details).toHaveLength(AUDIT_DETAILS_MAX_LENGTH);
    });

    it('never throws when the write fails, and logs it without the note', async () => {
      const { model, service } = setup();
      model.insertMany.mockRejectedValue(new Error('database down'));
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.record({
          adminId: ADMIN_ID,
          action: AuditAction.ResetPassword,
          targetType: AuditTargetType.User,
          targetId: TARGET_ID,
          details: 'secret-looking note',
        }),
      ).resolves.toBeUndefined();

      expect(logged).toHaveBeenCalledTimes(1);
      const [message] = logged.mock.calls[0] as [string];
      expect(message).toContain('reset_password');
      expect(message).toContain(TARGET_ID);
      expect(message).not.toContain('secret-looking note');
      logged.mockRestore();
    });

    it('has no method that changes or deletes a record (append-only)', () => {
      const methods = Object.getOwnPropertyNames(AuditService.prototype);

      expect(methods.sort()).toEqual(['constructor', 'list', 'record']);
    });
  });

  describe('list', () => {
    it('reads newest first, one page, and counts every match', async () => {
      const { model, service, findChain, stored } = setup();

      const result = await service.list({}, { skip: 20, limit: 10 });

      expect(model.find).toHaveBeenCalledWith({});
      expect(findChain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(findChain.skip).toHaveBeenCalledWith(20);
      expect(findChain.limit).toHaveBeenCalledWith(10);
      expect(model.countDocuments).toHaveBeenCalledWith({});
      expect(result).toEqual({ items: stored, total: 21 });
    });

    it('applies every given filter', async () => {
      const { model, service } = setup();

      await service.list(
        {
          adminId: ADMIN_ID,
          action: AuditAction.ResetPassword,
          targetType: AuditTargetType.User,
          targetId: TARGET_ID,
        },
        { skip: 0, limit: 10 },
      );

      const filter = {
        adminId: new Types.ObjectId(ADMIN_ID),
        action: 'reset_password',
        targetType: 'user',
        targetId: TARGET_ID,
      };
      expect(model.find).toHaveBeenCalledWith(filter);
      expect(model.countDocuments).toHaveBeenCalledWith(filter);
    });
  });
});
