import { PostSummaryResponseDto } from '../dto/post-summary-response.dto';

export interface PostSummarySource {
  _id: {
    toString(): string;
  };
  authorId: {
    toString(): string;
  };
  title: string;
  publishedAt?: Date;
}

export class PostSummaryMapper {
  static toResponse(post: PostSummarySource): PostSummaryResponseDto {
    if (!post.publishedAt) {
      throw new Error('Published post must have publishedAt');
    }

    return {
      id: post._id.toString(),
      authorId: post.authorId.toString(),
      title: post.title,
      publishedAt: post.publishedAt.toISOString(),
    };
  }
}
