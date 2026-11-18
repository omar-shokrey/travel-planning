import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { POST_BODY_MAX_LENGTH, POST_TITLE_MAX_LENGTH } from './create-post.dto';
import { PostStatus } from '../models/post-status.enum';
import { POST_TAG_MAX_LENGTH, POST_TAGS_MAX_COUNT } from '../blog.constants';
import { PostTags } from './post-tags.decorator';

const IfSent = () => ValidateIf((_dto, value) => value !== undefined);

export class UpdatePostDto {
  @ApiPropertyOptional({
    example: 'Three days in Cairo',
    maxLength: POST_TITLE_MAX_LENGTH,
    description: 'Optional. Outer spaces are removed.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IfSent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    example: 'I updated my experience in Cairo...',
    maxLength: POST_BODY_MAX_LENGTH,
    description: 'Optional. Outer spaces are removed.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IfSent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_BODY_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({
    enum: PostStatus,
    description:
      'Optional. Changes the post between draft and published. The server manages publishedAt.',
  })
  @IfSent()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({
    type: [String],
    example: ['cairo', 'egypt'],
    maxItems: POST_TAGS_MAX_COUNT,
    description: `Optional (BLG-08). The new tags: they replace the old ones, and \`[]\` removes them all. Up to ${POST_TAGS_MAX_COUNT} tags of at most ${POST_TAG_MAX_LENGTH} characters each, trimmed, lowercased and de-duplicated, as when the post is created. Leave it out to keep the tags.`,
  })
  @PostTags()
  tags?: string[];
}
