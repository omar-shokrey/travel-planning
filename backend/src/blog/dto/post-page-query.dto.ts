import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';

/**
 * BLG-02: the post page embeds one page of the post's comments. The route has
 * no list of its own, so the names say which list they page: `commentsPage`
 * and `commentsLimit`, with the same rules as `PaginationQueryDto` (GEN-05).
 * Unknown parameters are 400 (global pipe).
 */
export class PostPageQueryDto {
  @ApiPropertyOptional({
    description: 'Page of the comments, starting at 1',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  commentsPage: number = 1;

  @ApiPropertyOptional({
    description: 'Comments per page',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  commentsLimit: number = DEFAULT_PAGE_SIZE;

  /** The page of the comments list, as the comments service takes it. */
  commentsPagination(): PaginationQueryDto {
    return Object.assign(new PaginationQueryDto(), {
      page: this.commentsPage,
      limit: this.commentsLimit,
    });
  }
}
