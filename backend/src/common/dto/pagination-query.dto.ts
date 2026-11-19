import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GEN-05: lists are paginated with a page size of 10. */
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;
/**
 * The highest page number a list accepts. A page after the last one is an
 * empty page, not an error, so a real client never needs a number this large:
 * 10,000 pages is 100,000 rows at the default size. Without a limit, a page
 * such as `1e20` makes MongoDB refuse the `$skip` and the answer is a 500.
 */
export const MAX_PAGE = 10_000;

/**
 * Query parameters for every paginated list. Search and filter DTOs extend it:
 * `class SearchFlightsQueryDto extends PaginationQueryDto { ... }`.
 * Needs the global ValidationPipe with `transform: true`.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number, starting at 1',
    minimum: 1,
    maximum: MAX_PAGE,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE, { message: 'page is too large' })
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

  /**
   * `skip` is computed by the server from `page` and `limit`; a client never
   * sets it. A getter alone is not enough: when a client sends `?skip=5`,
   * class-transformer assigns it to the instance of the subclass, and
   * assigning to a getter-only property throws a TypeError (a 500). This
   * setter stores the sent value as an own field instead, so the global
   * validation pipe (`whitelist`, `forbidNonWhitelisted`) refuses it like any
   * parameter a list does not have: 400 "property skip should not exist".
   * The pipe always runs first, so a sent value never reaches a service.
   */
  set skip(sent: unknown) {
    Object.defineProperty(this, 'skip', {
      value: sent,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}
