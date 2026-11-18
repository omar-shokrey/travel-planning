import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PostSummaryResponseDto } from './dto/post-summary-response.dto';
import { SearchPostsQueryDto } from './dto/search-posts-query.dto';
import { PublishedPostsService } from './published-posts.service';

/**
 * `GET /api/posts` (BLG-09, BLG-02). A controller of its own, so the post
 * routes of `PostsController` stay as they are; `GET /api/posts/mine` is a
 * different path and is not affected.
 */
@ApiTags('Blog')
@Controller('posts')
export class PostSearchController {
  constructor(private readonly publishedPosts: PublishedPostsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Search published posts (BLG-09)',
    description:
      'Open to guests. With `q`, the published posts whose title, tags or author name contain the keyword (letter case ignored, part of a word is enough), ordered by interaction score (likes + comments) descending, newest first on a tie. Without `q`, the newest published posts. 10 per page by default (GEN-05). Each row has the title, the author, the publication date, an excerpt, the tags and the like and comment counts. No result is an empty page (`items: []`, `meta.total: 0`): the frontend shows "no results".',
  })
  @ApiPaginatedResponse(PostSummaryResponseDto)
  @ApiBadRequestResponse({
    description:
      '`q` is empty after trimming or longer than 100 characters, `page` or `limit` is invalid (limit at most 50), or the query has a parameter that is not allowed',
  })
  search(
    @Query() query: SearchPostsQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    return query.q === undefined
      ? this.publishedPosts.listNewest(query)
      : this.publishedPosts.search(query.q, query);
  }
}
