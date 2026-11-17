import { ApiProperty } from '@nestjs/swagger';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditTargetType } from '../enums/audit-target-type.enum';

/** One audit record as the admin audit log returns it (GEN-07). */
export class AuditLogResponseDto {
  @ApiProperty({ example: '6741c0ffee0123456789abcd' })
  id: string;

  @ApiProperty({
    description: 'The administrator who acted',
    example: '6740f1c2a4b5c6d7e8f90001',
  })
  adminId: string;

  @ApiProperty({
    enum: AuditAction,
    enumName: 'AuditAction',
    example: AuditAction.ResetPassword,
  })
  action: AuditAction;

  @ApiProperty({
    enum: AuditTargetType,
    enumName: 'AuditTargetType',
    example: AuditTargetType.User,
  })
  targetType: AuditTargetType;

  @ApiProperty({
    description: 'The id of the record the action touched',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  targetId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'A short note, or null',
    example: 'hotel_moderator of hotel 6740f1c2a4b5c6d7e8f90abc',
  })
  details: string | null;

  @ApiProperty({
    description: 'When the action happened, in UTC',
    example: '2026-11-16T09:30:00.000Z',
  })
  createdAt: string;
}
