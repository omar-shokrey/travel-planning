import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReportTargetType } from '../enums/report-target-type.enum';
import { REPORT_REASON_MAX_LENGTH } from '../reports.constants';

/**
 * What a registered user sends to report content (GEN-09). Every field is
 * required and none uses @IsOptional(), so a missing field or `null` answers
 * 400. The reporter, the status and the dates are set by the server.
 */
export class CreateReportDto {
  @ApiProperty({
    enum: ReportTargetType,
    example: ReportTargetType.Post,
    description:
      'Required. What is reported: a blog post, a comment on a post, or an itinerary.',
  })
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ApiProperty({
    example: '6745a1b2c3d4e5f6a7b8c9d0',
    description: 'Required. The id of the post, comment or itinerary.',
  })
  @IsMongoId()
  targetId: string;

  @ApiProperty({
    example: 'This post contains spam links.',
    maxLength: REPORT_REASON_MAX_LENGTH,
    description:
      'Required. Why the content is reported. Outer spaces are removed.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(REPORT_REASON_MAX_LENGTH)
  reason: string;
}
