import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GEN-05: lists are paginated with a page size of 10. */
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

/**
 * Query parameters for every paginated list. Search and filter DTOs extend it:
 * `class SearchFlightsQueryDto extends PaginationQueryDto { ... }`.
 * Needs the global ValidationPipe with `transform: true`.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number, starting at 1',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  /** How many documents to skip, for Mongoose `.skip()`. */
  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
