import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditTargetType } from '../../audit/enums/audit-target-type.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * `GET /api/admin/audit-logs?page=1&limit=10&action=reset_password&adminId=…&targetType=user&targetId=…`
 * (GEN-07, GEN-05). Every filter is optional; together they must all match.
 */
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Only records of this action',
    enum: AuditAction,
    enumName: 'AuditAction',
  })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({
    description: 'Only actions of this administrator',
    example: '6740f1c2a4b5c6d7e8f90001',
  })
  @IsOptional()
  @IsMongoId()
  adminId?: string;

  @ApiPropertyOptional({
    description: 'Only actions on this kind of record',
    enum: AuditTargetType,
    enumName: 'AuditTargetType',
  })
  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;

  @ApiPropertyOptional({
    description: 'Only actions on the record with this id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @IsOptional()
  @IsMongoId()
  targetId?: string;
}
