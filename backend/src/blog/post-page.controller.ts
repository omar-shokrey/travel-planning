import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { PostPageQueryDto } from './dto/post-page-query.dto';
import { PostPageResponseDto } from './dto/post-page-response.dto';
import { PostPageService } from './post-page.service';

/**
 * `GET /api/posts/:id` (BLG-02). A controller of its own, registered after
 * `PostsController`, so `GET /api/posts/mine` is matched first and is never
 * read as a post id.
 */
@ApiTags('Blog')
@Controller('posts')
export class PostPageController {
  constructor(private readonly postPage: PostPageService) {}

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Open a published post (BLG-02)',
    description:
      'Open to guests. The title, author, publication date, full body, tags, images, like count and comment count, with the first page of the comments, oldest first. `commentsPage` and `commentsLimit` choose another page (10 per page by default, at most 50: GEN-05); more pages also come from `GET /api/posts/{id}/comments`. A comment an admin hid is left out. Liking, commenting and reporting need a login (ACC-10). A draft, a post an admin hid and a post that does not exist all answer 404, for everyone, the author included.',
  })
  @ApiParam({
    name: 'id',
    description: 'The id of the post',
    example: '6740f1c2a4b5c6d7e8f90abc',
  })
  @ApiOkResponse({ type: PostPageResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, `commentsPage` or `commentsLimit` is invalid (limit at most 50), or the query has a parameter that is not allowed',
  })
  @ApiNotFoundResponse({
    description:
      'Post not found: it does not exist, it is a draft, or an admin hid it',
  })
  findPage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PostPageQueryDto,
  ): Promise<PostPageResponseDto> {
    return this.postPage.findPage(id, query);
  }
}
