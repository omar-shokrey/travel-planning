import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';
import { Comment, CommentSchema } from './models/comment.schema';
import { Like, LikeSchema } from './models/like.schema';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { BlogPost, BlogPostSchema } from './models/blog-post.schema';
import { PublishedPostsService } from './published-posts.service';
import { TagsController } from './tags.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
    ]),
    // The User model, read only, for the author names of the public lists (BLG-08).
    UsersModule,
  ],
  controllers: [
    PostsController,
    TagsController,
    CommentsController,
    LikesController,
  ],
  providers: [
    PostsService,
    PublishedPostsService,
    CommentsService,
    LikesService,
  ],
  exports: [PostsService, CommentsService, LikesService],
})
export class BlogModule {}
