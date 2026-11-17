import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ReportStatus } from '../../reports/enums/report-status.enum';
import { ReportTargetType } from '../../reports/enums/report-target-type.enum';

/**
 * `GET /api/admin/reports?page=1&limit=10&status=open&targetType=post`
 * (GEN-10, GEN-05). Without `status` the list shows the open reports, the
 * admin's work queue.
 */
export class ListReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Only reports with this status. Default: `open`.',
    enum: ReportStatus,
    enumName: 'ReportStatus',
    default: ReportStatus.Open,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status: ReportStatus = ReportStatus.Open;

  @ApiPropertyOptional({
    description: 'Only reports of this kind of content',
    enum: ReportTargetType,
    enumName: 'ReportTargetType',
  })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}
