import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ContentModeration } from '../enums/content-moderation.enum';

/**
 * `PATCH /api/admin/content/:type/:id` (GEN-10): hide a post or an itinerary
 * directly, or show it again. Required, `null` included.
 */
export class ModerateContentDto {
  @ApiProperty({
    enum: ContentModeration,
    enumName: 'ContentModeration',
    example: ContentModeration.Hidden,
    description:
      'Required. `hidden` hides the content from everyone but its author and admins; `visible` undoes a hide.',
  })
  @IsEnum(ContentModeration)
  moderation: ContentModeration;
}
