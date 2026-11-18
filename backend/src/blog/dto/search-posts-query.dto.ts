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
import { POST_SEARCH_MAX_LENGTH } from '../blog.constants';

/** The query of `GET /api/posts`: a page, and an optional keyword (BLG-09). */
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
}
