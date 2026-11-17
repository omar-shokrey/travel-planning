import { Controller, Delete, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { LikeResponseDto } from './dto/like-response.dto';
import { LikesService } from './likes.service';

/** Likes on blog posts (BLG-06). */
@ApiTags('Blog')
@ApiCookieAuth()
@ApiBadRequestResponse({ description: 'The post id is not a valid id' })
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({ description: 'Only registered users can like posts' })
@ApiNotFoundResponse({ description: 'No published post has this id' })
@Controller('posts')
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @Post(':id/like')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Like a post (BLG-06)',
    description:
      'BLG-06. A registered user likes a published post. A user can like a post only once. The response shows the new like count.',
  })
  @ApiParam({ name: 'id', description: 'The id of the post' })
  @ApiCreatedResponse({ type: LikeResponseDto })
  @ApiConflictResponse({ description: 'You have already liked this post' })
  like(
    @Param('id', ParseObjectIdPipe) postId: string,
    @CurrentUser('id') userId: string,
  ): Promise<LikeResponseDto> {
    return this.likes.like(postId, userId);
  }

  @Delete(':id/like')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Remove my like from a post (BLG-06)',
    description:
      'BLG-06. A registered user removes their own like from a post. The response shows the new like count.',
  })
  @ApiParam({ name: 'id', description: 'The id of the post' })
  @ApiOkResponse({ type: LikeResponseDto })
  @ApiConflictResponse({ description: 'You have not liked this post' })
  unlike(
    @Param('id', ParseObjectIdPipe) postId: string,
    @CurrentUser('id') userId: string,
  ): Promise<LikeResponseDto> {
    return this.likes.unlike(postId, userId);
  }
}
