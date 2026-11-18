import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { AuthorsController } from './authors.controller';
import { AuthorsService } from './authors.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';
import { Comment, CommentSchema } from './models/comment.schema';
import { Like, LikeSchema } from './models/like.schema';
import { PostImagesController } from './post-images.controller';
import { PostImagesService } from './post-images.service';
import { PostSearchController } from './post-search.controller';
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
    // UploadsService: post images (BLG-10, GEN-08).
    UploadsModule,
    // PublicItinerariesService: the public itineraries of the author page
    // (BLG-12). ItinerariesModule does not import BlogModule, so no cycle.
    ItinerariesModule,
  ],
  controllers: [
    PostsController,
    PostSearchController,
    TagsController,
    AuthorsController,
    PostImagesController,
    CommentsController,
    LikesController,
  ],
  providers: [
    PostsService,
    PublishedPostsService,
    AuthorsService,
    PostImagesService,
    CommentsService,
    LikesService,
  ],
  exports: [PostsService, CommentsService, LikesService],
})
export class BlogModule {}
