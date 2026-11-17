import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UploadsModule } from '../uploads/uploads.module';
import { PostImagesController } from './post-images.controller';
import { PostImagesService } from './post-images.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { BlogPost, BlogPostSchema } from './models/blog-post.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
    ]),
    // UploadsService: post images (BLG-10, GEN-08).
    UploadsModule,
  ],
  controllers: [PostsController, PostImagesController],
  providers: [PostsService, PostImagesService],
  exports: [PostsService],
})
export class BlogModule {}
