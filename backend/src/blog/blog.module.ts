import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { AuthorsController } from './authors.controller';
import { AuthorsService } from './authors.service';
import { BlogPost, BlogPostSchema } from './models/blog-post.schema';
import { PublishedPostsService } from './services/published-posts.service';

@Module({
  imports: [
    UsersModule,
    ItinerariesModule,
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
    ]),
  ],
  controllers: [AuthorsController],
  providers: [AuthorsService, PublishedPostsService],
  exports: [AuthorsService],
})
export class BlogModule {}
