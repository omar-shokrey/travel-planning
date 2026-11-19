import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CommentsService } from './comments.service';
import type { PostPageQueryDto } from './dto/post-page-query.dto';
import type { PostPageResponseDto } from './dto/post-page-response.dto';
import { toPostPage, type PostPageSource } from './mappers/post-page.mapper';
import { BlogPost } from './models/blog-post.schema';
import { PublishedPostsService } from './published-posts.service';
import { visiblePublishedPost } from './visible-post.filter';

/** The fields of a post that the page shows. */
const PAGE_FIELDS =
  'authorId title body tags images publishedAt likeCount commentCount';

/** BLG-02: the public page of a published post. */
@Injectable()
export class PostPageService {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    private readonly comments: CommentsService,
    private readonly publishedPosts: PublishedPostsService,
  ) {}

  /**
   * The post with its author, tags, images, counters and one page of its
   * comments (oldest first). The route is public, so the post is looked up
   * without a viewer: a draft, a post an admin hid (GEN-10) and a missing post
   * all answer the same 404, even for the author.
   *
   * The post and the comments page are read at the same time. The comments
   * service does not check the post (this read has), and a post that turns out
   * to be missing or not visible is a 404 whatever the comments read found.
   * The names of the post author and of the authors of the comments on the
   * page are then read in one query. A missing or deactivated account is shown
   * as "Deleted user" (the lists do the same).
   */
  async findPage(
    id: string,
    query: PostPageQueryDto,
  ): Promise<PostPageResponseDto> {
    const pagination = query.commentsPagination();
    const [post, comments] = await Promise.all([
      this.posts
        .findOne(visiblePublishedPost(id))
        .select(PAGE_FIELDS)
        .lean<PostPageSource>()
        .exec(),
      this.comments.findVisibleComments(id, pagination),
    ]);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const authorNames = await this.publishedPosts.authorNamesOf([
      post.authorId,
      ...comments.comments.map((comment) => comment.authorId),
    ]);
    return toPostPage(
      post,
      comments.comments,
      comments.total,
      pagination,
      authorNames,
    );
  }
}
