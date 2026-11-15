import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreatePostDto } from './dto/create-post.dto';
import { PostResponseDto } from './dto/post-response.dto';
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
}
