import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreatePostDto } from './dto/create-post.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { PostsService } from './posts.service';

@ApiTags('Blog')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @ApiCreatedResponse({ type: PostResponseDto })
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser('id') userId: string,
  ): Promise<PostResponseDto> {
    return this.posts.create(dto, userId);
  }
}
