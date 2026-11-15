import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CommentsService } from './comments.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

/** Comments on blog posts (BLG-05). */
@ApiTags('Blog')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('posts/:id/comments')
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Comment on a post (BLG-05)',
    description:
      'BLG-05. A registered user comments on a published post. The comment must not be empty and has at most 500 characters. The author is the logged-in user.',
  })
  @ApiParam({ name: 'id', description: 'The id of the post' })
  @ApiCreatedResponse({ type: CommentResponseDto })
  @ApiBadRequestResponse({
    description:
      'The post id is not a valid id, the comment is empty or longer than 500 characters, or the body has a field that is not allowed',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: 'Only registered users can comment',
  })
  @ApiNotFoundResponse({
    description: 'No published post has this id',
  })
  create(
    @Param('id', ParseObjectIdPipe) postId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser('id') userId: string,
  ): Promise<CommentResponseDto> {
    return this.comments.create(postId, dto, userId);
  }

  @Get('posts/:id/comments')
  @Public()
  @ApiOperation({
    summary: 'List the comments of a post (BLG-05)',
    description:
      'BLG-05. The comments of a published post in chronological order (oldest first), 10 per page by default (GEN-05). Open to guests.',
  })
  @ApiParam({ name: 'id', description: 'The id of the post' })
  @ApiPaginatedResponse(CommentResponseDto)
  @ApiBadRequestResponse({
    description:
      'The post id is not a valid id, or `page` or `limit` is invalid',
  })
  @ApiNotFoundResponse({
    description: 'No published post has this id',
  })
  list(
    @Param('id', ParseObjectIdPipe) postId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    return this.comments.listForPost(postId, query);
  }
}
