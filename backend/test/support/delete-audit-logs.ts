import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AuditLog } from './../../src/audit/models/audit-log.schema';

/**
 * Deletes the audit records (GEN-07) that a test caused, one by one by id:
 * every record whose target or admin is one of the given ids, which the test
 * created itself. The app never deletes audit records; only a test cleans up
 * its own, and only in the `-test` database.
 */
export async function deleteAuditLogsOf(
  app: INestApplication,
  ids: string[],
): Promise<void> {
  const auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  for (const id of ids) {
    const byTarget = await auditLogs
      .find({ targetId: id })
      .select('_id')
      .lean()
      .exec();
    const byAdmin = await auditLogs
      .find({ adminId: id })
      .select('_id')
      .lean()
      .exec();
    for (const { _id } of [...byTarget, ...byAdmin]) {
      await auditLogs.findByIdAndDelete(_id).exec();
    }
  }
}
