import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { BlogPost, BlogPostSchema } from './models/blog-post.schema';
import { PublishedPostsService } from './published-posts.service';
import { TagsController } from './tags.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
    ]),
    // The User model, read only, for the author names of the public lists (BLG-08).
    UsersModule,
  ],
  controllers: [PostsController, TagsController],
  providers: [PostsService, PublishedPostsService],
  exports: [PostsService],
})
export class BlogModule {}
