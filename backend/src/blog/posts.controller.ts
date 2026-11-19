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
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreatePostDto } from './dto/create-post.dto';
import { MyPostResponseDto } from './dto/my-post-response.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

@ApiTags('Blog')
@ApiCookieAuth()
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Create a blog post (BLG-01)',
    description:
      'Registered users only. Send a `title` and a `body` (both required), optional `tags` (up to 5, each at most 30 characters, stored lowercase) and an optional `status`: `draft` (the default) or `published`. The author is the logged-in user and `publishedAt` is set by the server when the post is published. Images are added afterwards with `POST /api/posts/{id}/images` (BLG-10).',
  })
  @ApiCreatedResponse({
    description: 'The post was created',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'A field is invalid: a missing or empty title or body, a title over 200 or a body over 20,000 characters, more than 5 tags or a tag over 30 characters, an unknown status, or a field the server sets (such as `authorId`). `errors` lists each field.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not a registered user (moderators and admins do not write posts), or the account is suspended',
  })
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser('id') userId: string,
  ): Promise<PostResponseDto> {
    return this.posts.create(dto, userId);
  }

  // `GET /posts/:id` (BLG-02) is in PostPageController, which BlogModule
  // registers after this controller. Express matches routes in registration
  // order, so `mine` is matched first and is never read as a post id.
  @Get('mine')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'List my posts (BLG-03)',
    description:
      'Registered users only. The posts of the logged-in user, drafts and published, newest first, 10 per page by default (GEN-05). Each row has the title, the status, the dates and the like and comment counts. An empty page is `items: []`.',
  })
  @ApiPaginatedResponse(MyPostResponseDto)
  @ApiBadRequestResponse({
    description:
      '`page` or `limit` is invalid (limit at most 50), or the query has a parameter that is not allowed',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not a registered user (moderators and admins have no posts), or the account is suspended',
  })
  listMine(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<MyPostResponseDto>> {
    return this.posts.listMine(userId, query);
  }

  @Patch(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Edit your own blog post (BLG-04)',
    description:
      'Registered users can edit only their own posts. Title, body, status and tags (BLG-08) are editable; the tags sent replace the old ones and `[]` removes them. Images are managed by their own routes (BLG-10). When a post is published, the server manages publishedAt.',
  })
  @ApiResponse({
    status: 200,
    description: 'The post was updated',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The post id is malformed, or a field is invalid, such as an empty title or body, a title over 200 characters, a body over 20,000 characters, an unknown status, more than 5 tags or a tag over 30 characters.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not a registered user, or the post belongs to another user.',
  })
  @ApiNotFoundResponse({
    description: 'The requested post does not exist.',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser('id') userId: string,
  ): Promise<PostResponseDto> {
    return this.posts.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(Role.User)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete your own blog post (BLG-04)',
    description: 'Registered users can delete only their own posts.',
  })
  @ApiNoContentResponse({ description: 'The post was deleted' })
  @ApiBadRequestResponse({
    description: 'The post id is not a valid MongoDB ObjectId.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not a registered user, or the post belongs to another user.',
  })
  @ApiNotFoundResponse({
    description: 'The requested post does not exist.',
  })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.posts.remove(id, userId);
  }
}
