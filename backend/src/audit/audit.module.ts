import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditService } from './audit.service';
import { AuditLog, AuditLogSchema } from './models/audit-log.schema';

/**
 * The audit records of admin actions (GEN-07). It has no controller: the
 * admin console shows the log at `GET /api/admin/audit-logs` (AdminModule).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [AuditService],
  // Other modules record actions and read the log through the service only.
  exports: [AuditService],
})
export class AuditModule {}
