import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommentResponseDto } from '../../blog/dto/comment-response.dto';
import { PostResponseDto } from '../../blog/dto/post-response.dto';
import { ItineraryDetailResponseDto } from '../../itineraries/dto/itinerary-detail-response.dto';
import { ReportTargetType } from '../../reports/enums/report-target-type.enum';
import { ContentModeration } from '../enums/content-moderation.enum';

/**
 * The answer of `GET /api/admin/content/:type/:id` (GEN-10): any post,
 * comment or itinerary, hidden or not, in its own module's response shape.
 * Exactly one of `post`, `comment` and `itinerary` is set, the one of `type`.
 */
export class AdminContentResponseDto {
  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.Comment })
  type: ReportTargetType;

  @ApiProperty({ example: '6745a1b2c3d4e5f6a7b8c9d0' })
  id: string;

  @ApiProperty({
    enum: ContentModeration,
    example: ContentModeration.Hidden,
    description: '`hidden` when an admin hid the content',
  })
  moderation: ContentModeration;

  @ApiPropertyOptional({
    type: PostResponseDto,
    description: 'Set when `type` is `post`. A draft is shown too.',
  })
  post?: PostResponseDto;

  @ApiPropertyOptional({
    type: CommentResponseDto,
    description: 'Set when `type` is `comment`',
  })
  comment?: CommentResponseDto;

  @ApiPropertyOptional({
    type: ItineraryDetailResponseDto,
    description:
      'Set when `type` is `itinerary`, with its days, private or public',
  })
  itinerary?: ItineraryDetailResponseDto;
}
