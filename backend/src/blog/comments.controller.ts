import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
import { UpdateCommentDto } from './dto/update-comment.dto';

/** Comments on blog posts (BLG-05, BLG-07). */
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
      'BLG-05. The comments of a published post in chronological order (oldest first), 10 per page by default (GEN-05). Open to guests. Comments an admin hid (GEN-10) are left out.',
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

  @Patch('comments/:id')
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit my comment (BLG-07)',
    description:
      'BLG-07. A registered user changes the text of their own comment. The new text must not be empty and has at most 500 characters. `updatedAt` shows when the comment was edited.',
  })
  @ApiParam({ name: 'id', description: 'The id of the comment' })
  @ApiOkResponse({ type: CommentResponseDto })
  @ApiBadRequestResponse({
    description:
      'The comment id is not a valid id, the text is empty or longer than 500 characters, or the body has a field that is not allowed',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The comment was written by another user, or the account is not a registered user',
  })
  @ApiNotFoundResponse({ description: 'No comment has this id' })
  update(
    @Param('id', ParseObjectIdPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser('id') userId: string,
  ): Promise<CommentResponseDto> {
    return this.comments.update(commentId, dto, userId);
  }

  @Delete('comments/:id')
  @Roles(Role.User)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Delete my comment (BLG-07)',
    description:
      'BLG-07. A registered user deletes their own comment, also one an admin hid. The comment count of the post goes down by one if the comment was visible (a hidden comment was already taken off it).',
  })
  @ApiParam({ name: 'id', description: 'The id of the comment' })
  @ApiNoContentResponse({ description: 'The comment was deleted' })
  @ApiBadRequestResponse({
    description: 'The comment id is not a valid id',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The comment was written by another user, or the account is not a registered user',
  })
  @ApiNotFoundResponse({ description: 'No comment has this id' })
  remove(
    @Param('id', ParseObjectIdPipe) commentId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.comments.remove(commentId, userId);
  }
}
