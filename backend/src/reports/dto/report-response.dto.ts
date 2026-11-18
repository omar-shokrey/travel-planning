import { ApiProperty } from '@nestjs/swagger';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportTargetType } from '../enums/report-target-type.enum';

/** A report as the API returns it. It never names the reporter. */
export class ReportResponseDto {
  @ApiProperty({ example: '6745a1b2c3d4e5f6a7b8c9d1' })
  id: string;

  @ApiProperty({ enum: ReportTargetType })
  targetType: ReportTargetType;

  @ApiProperty({ example: '6745a1b2c3d4e5f6a7b8c9d0' })
  targetId: string;

  @ApiProperty({ example: 'This post contains spam links.' })
  reason: string;

  @ApiProperty({ enum: ReportStatus, example: ReportStatus.Open })
  status: ReportStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-16T10:00:00.000Z',
  })
  createdAt: string;
}
