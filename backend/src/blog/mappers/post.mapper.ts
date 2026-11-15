import { PostResponseDto } from '../dto/post-response.dto';
import { BlogPostDocument } from '../models/blog-post.schema';

export function toPostResponse(post: BlogPostDocument): PostResponseDto {
  return {
    id: post.id,
    authorId: post.authorId.toString(),
    title: post.title,
    body: post.body,
    status: post.status,
    publishedAt: post.publishedAt,
    tags: post.tags,
    images: post.images,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}
