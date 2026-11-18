import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PostStatus } from '../models/post-status.enum';
import { POST_TAG_MAX_LENGTH, POST_TAGS_MAX_COUNT } from '../blog.constants';
import { PostTags } from './post-tags.decorator';

/**
 * The longest title and body a post may have, counted after trimming. The
 * workbook sets no limit; these keep a single request from storing megabytes
 * of text, and are long enough for any real title and article.
 */
export const POST_TITLE_MAX_LENGTH = 200;
export const POST_BODY_MAX_LENGTH = 20_000;

/**
 * Validates a field only when it was sent. Unlike @IsOptional(), it does not
 * let `null` through, so `"status": null` or `"tags": null` answers 400
 * instead of storing a post with no status or no tags.
 */
const IfSent = () => ValidateIf((_dto, value) => value !== undefined);

/**
 * What a registered user sends to create a post (BLG-01). The author, the
 * publication time and the images are not here: the server sets the author
 * and `publishedAt`, and images are added afterwards (BLG-10).
 */
export class CreatePostDto {
  @ApiProperty({
    example: 'Three days in Cairo',
    maxLength: POST_TITLE_MAX_LENGTH,
    description: 'Required. Outer spaces are removed.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_TITLE_MAX_LENGTH)
  title: string;

  @ApiProperty({
    example: 'I spent three amazing days exploring Cairo...',
    maxLength: POST_BODY_MAX_LENGTH,
    description: 'Required. Outer spaces are removed.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_BODY_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    enum: PostStatus,
    default: PostStatus.Draft,
    description:
      '`draft` (the default) keeps the post private to its author; `published` makes it public and sets `publishedAt`.',
  })
  @IfSent()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({
    type: [String],
    example: ['cairo', 'egypt'],
    maxItems: POST_TAGS_MAX_COUNT,
    description: `Up to ${POST_TAGS_MAX_COUNT} tags of at most ${POST_TAG_MAX_LENGTH} characters each (BLG-08). They are trimmed, lowercased and de-duplicated; empty tags are dropped.`,
  })
  @PostTags()
  tags?: string[];
}
