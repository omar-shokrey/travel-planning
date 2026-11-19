import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { POST_SEARCH_MAX_LENGTH, POST_TAG_MAX_LENGTH } from '../blog.constants';

/**
 * The query of `GET /api/posts`: a page, an optional keyword (BLG-09) and an
 * optional tag (BLG-02).
 */
export class SearchPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    maxLength: POST_SEARCH_MAX_LENGTH,
    description:
      'A keyword looked for in the title, the tags and the author name, ignoring letter case; part of a word is enough. Outer spaces are removed. Leave it out to get the newest published posts.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @IsNotEmpty({
    message: 'q must not be empty: leave it out to list all posts',
  })
  @MaxLength(POST_SEARCH_MAX_LENGTH)
  // MongoDB refuses a pattern with a null byte; no keyword needs a control character.
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001f\u007f]*$/, {
    message: 'q must not contain control characters',
  })
  q?: string;

  @ApiPropertyOptional({
    example: 'cairo',
    maxLength: POST_TAG_MAX_LENGTH,
    description:
      'Only the posts that have this tag (BLG-02). Outer spaces and letter case are ignored, as when a tag is saved. Works alone or together with `q`. A tag nobody uses gives an empty page. Leave it out to list posts of every tag.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsString()
  @IsNotEmpty({
    message: 'tag must not be empty: leave it out to list all posts',
  })
  @MaxLength(POST_TAG_MAX_LENGTH)
  tag?: string;
}
