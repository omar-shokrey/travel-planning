import type { Types } from 'mongoose';
import type { AuditLogResponseDto } from '../dto/audit-log-response.dto';
import type { AuditLog } from '../models/audit-log.schema';

/** The fields the mapper reads. An audit document and a lean one both fit. */
export type AuditLogSource = Pick<
  AuditLog,
  'adminId' | 'action' | 'targetType' | 'targetId' | 'details' | 'createdAt'
> & { _id: Types.ObjectId };

/** Turns a stored audit record into what the API returns. */
export function toAuditLogResponse(log: AuditLogSource): AuditLogResponseDto {
  return {
    id: log._id.toString(),
    adminId: log.adminId.toString(),
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    details: log.details ?? null,
    createdAt: log.createdAt.toISOString(),
  };
}
