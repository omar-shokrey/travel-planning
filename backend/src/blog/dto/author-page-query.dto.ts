import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';

/** A page of one list, as the list services take it. */
function pageOf(page: number, limit: number): PaginationQueryDto {
  return Object.assign(new PaginationQueryDto(), { page, limit });
}

/**
 * BLG-12: the author page has two lists, so each one has its own page and
 * page size (GEN-05), with the same rules as `PaginationQueryDto`. One request
 * can then page either list. Unknown parameters are 400 (global pipe).
 */
export class AuthorPageQueryDto {
  @ApiPropertyOptional({
    description: 'Page of the published posts, starting at 1',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  postsPage: number = 1;

  @ApiPropertyOptional({
    description: 'Published posts per page',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  postsLimit: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Page of the public itineraries, starting at 1',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage: number = 1;

  @ApiPropertyOptional({
    description: 'Public itineraries per page',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  itinerariesLimit: number = DEFAULT_PAGE_SIZE;

  /** The page of the posts list. */
  postsPagination(): PaginationQueryDto {
    return pageOf(this.postsPage, this.postsLimit);
  }

  /** The page of the itineraries list. */
  itinerariesPagination(): PaginationQueryDto {
    return pageOf(this.itinerariesPage, this.itinerariesLimit);
  }
}
