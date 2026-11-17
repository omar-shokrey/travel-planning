import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model, type QueryFilter } from 'mongoose';
import { AUDIT_DETAILS_MAX_LENGTH } from './audit.constants';
import type { AuditAction } from './enums/audit-action.enum';
import type { AuditTargetType } from './enums/audit-target-type.enum';
import { AuditLog, type AuditLogDocument } from './models/audit-log.schema';

/** One admin action to record (GEN-07). */
export interface AuditEntry {
  /** The administrator who acted: `@CurrentUser('id')` in the controller. */
  adminId: string | Types.ObjectId;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | Types.ObjectId;
  /** A short public note. Never a password, a hash, a token or an email. */
  details?: string;
}

/** The filters of the admin audit log. All given filters must match. */
export interface AuditLogCriteria {
  adminId?: string;
  action?: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
}

/**
 * Owns the `audit_logs` collection (GEN-07). The log is append-only: this
 * service can add a record and read the list, and has no method that changes
 * or deletes one. Other modules import `AuditModule` and call `record` after
 * their own write has succeeded.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogs: Model<AuditLog>,
  ) {}

  /**
   * Appends one record. It never throws: the admin action it describes has
   * already been saved and cannot be undone here, so a failed write is
   * logged on the server and must not turn that success into an error (the
   * admin would retry an action that already happened).
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogs.insertMany([
        {
          adminId: new Types.ObjectId(entry.adminId),
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId.toString(),
          // Cut, not refused: a longer note (an airline name has no length
          // limit at creation) would fail the schema and lose the record.
          details: entry.details?.slice(0, AUDIT_DETAILS_MAX_LENGTH),
        },
      ]);
    } catch (error) {
      // No details: only what identifies the action, which is not private.
      this.logger.error(
        `Could not record the audit entry "${entry.action}" on ${entry.targetType} ${entry.targetId.toString()} by admin ${entry.adminId.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * One page of the log, newest first (by `createdAt`, then `_id`, so the
   * order is stable when two records share a moment). Returns entities; the
   * admin module maps them.
   */
  async list(
    criteria: AuditLogCriteria,
    page: { skip: number; limit: number },
  ): Promise<{ items: AuditLogDocument[]; total: number }> {
    const filter: QueryFilter<AuditLog> = {
      ...(criteria.adminId && {
        adminId: new Types.ObjectId(criteria.adminId),
      }),
      ...(criteria.action && { action: criteria.action }),
      ...(criteria.targetType && { targetType: criteria.targetType }),
      ...(criteria.targetId && { targetId: criteria.targetId }),
    };

    const [items, total] = await Promise.all([
      this.auditLogs
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .exec(),
      this.auditLogs.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }
}
