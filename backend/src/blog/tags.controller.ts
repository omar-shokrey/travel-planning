import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PostSummaryResponseDto } from './dto/post-summary-response.dto';
import { TagParamDto } from './dto/tag-param.dto';
import { PublishedPostsService } from './published-posts.service';

@ApiTags('Blog')
@Controller('tags')
export class TagsController {
  constructor(private readonly publishedPosts: PublishedPostsService) {}

  @Public()
  @Get(':tag/posts')
  @ApiOperation({
    summary: 'List the posts of a tag (BLG-08)',
    description:
      'Open to guests. The published posts that have the tag, newest first, 10 per page by default (GEN-05). The tag is read like a saved tag: outer spaces and letter case are ignored. Each row has the title, the author, the publication date, an excerpt, the tags and the like and comment counts. A tag nobody uses gives an empty page (`items: []`), not 404.',
  })
  @ApiPaginatedResponse(PostSummaryResponseDto)
  @ApiBadRequestResponse({
    description:
      'The tag is empty or longer than 30 characters, `page` or `limit` is invalid (limit at most 50), or the query has a parameter that is not allowed',
  })
  listByTag(
    @Param() params: TagParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<PostSummaryResponseDto>> {
    return this.publishedPosts.listByTag(params.tag, query);
  }
}
