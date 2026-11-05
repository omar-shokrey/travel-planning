import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({
    description: 'Number of matching items in total',
    example: 42,
  })
  total: number;

  @ApiProperty({ description: '0 when nothing matches', example: 5 })
  totalPages: number;
}

/** The body of every paginated list. An empty page is `items: []` (GEN-04). */
export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Builds the paginated body from one page of items and the total count. */
export function paginate<T>(
  items: T[],
  total: number,
  query: { page: number; limit: number },
): PaginatedResponse<T> {
  return {
    items,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
