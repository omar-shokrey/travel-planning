import { ApiProperty } from '@nestjs/swagger';
import { ReportTargetType } from '../../reports/enums/report-target-type.enum';
import { ContentModeration } from '../enums/content-moderation.enum';

/** The answer of `PATCH /api/admin/content/:type/:id` (GEN-10). */
export class ContentModerationResponseDto {
  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.Post })
  type: ReportTargetType;

  @ApiProperty({ example: '6745a1b2c3d4e5f6a7b8c9d0' })
  id: string;

  @ApiProperty({ enum: ContentModeration, example: ContentModeration.Hidden })
  moderation: ContentModeration;
}
