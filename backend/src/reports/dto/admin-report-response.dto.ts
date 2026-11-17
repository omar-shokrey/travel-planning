import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportResponseDto } from './report-response.dto';

/**
 * A report as an admin sees it (GEN-10): the public fields plus the reporter
 * and, once it is resolved, who resolved it and when.
 */
export class AdminReportResponseDto extends ReportResponseDto {
  @ApiProperty({
    example: '6745a1b2c3d4e5f6a7b8c9d2',
    description: 'The user who reported the content.',
  })
  reporterId: string;

  @ApiPropertyOptional({
    example: '6745a1b2c3d4e5f6a7b8c9d3',
    description:
      'The admin who resolved the report. Left out while it is open.',
  })
  resolvedBy?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-17T09:30:00.000Z',
    description:
      'When the report was resolved, in UTC. Left out while it is open.',
  })
  resolvedAt?: string;
}
