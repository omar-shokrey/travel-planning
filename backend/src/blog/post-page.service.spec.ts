import { NotFoundException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { DELETED_USER_NAME } from './blog.constants';
import type { CommentsService } from './comments.service';
import { PostPageQueryDto } from './dto/post-page-query.dto';
import type { PostPageSource } from './mappers/post-page.mapper';
import type { BlogPost } from './models/blog-post.schema';
import type { CommentDocument } from './models/comment.schema';
import { PostPageService } from './post-page.service';
import type { PublishedPostsService } from './published-posts.service';
import { visiblePublishedPost } from './visible-post.filter';

const POST_ID = '6740f1c2a4b5c6d7e8f90abc';
const SARA = new Types.ObjectId('6740f1c2a4b5c6d7e8f90001');
const OMAR = new Types.ObjectId('6740f1c2a4b5c6d7e8f90002');
const GONE = new Types.ObjectId('6740f1c2a4b5c6d7e8f90003');

const storedPost = (
  overrides: Partial<PostPageSource> = {},
): PostPageSource => ({
  _id: new Types.ObjectId(POST_ID),
  authorId: SARA,
  title: 'Three days in Cairo',
  body: 'The whole body',
  tags: ['cairo'],
  images: ['a.jpg'],
  publishedAt: new Date('2026-11-15T10:00:00.000Z'),
  likeCount: 3,
  commentCount: 2,
  ...overrides,
});

const storedComment = (
  id: string,
  authorId: Types.ObjectId,
  body: string,
): CommentDocument =>
  ({
    _id: new Types.ObjectId(id),
    authorId,
    body,
    createdAt: new Date('2026-11-15T11:00:00.000Z'),
    updatedAt: new Date('2026-11-15T11:00:00.000Z'),
  }) as unknown as CommentDocument;

const FIRST = storedComment('6740a1b2c3d4e5f601234561', OMAR, 'First');
const SECOND = storedComment('6740a1b2c3d4e5f601234562', GONE, 'Second');

interface Options {
  post?: PostPageSource | null;
  comments?: CommentDocument[];
  total?: number;
  names?: Map<string, string>;
}

function setup(options: Options = {}) {
  const post = options.post === undefined ? storedPost() : options.post;
  const chain = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(post),
  };
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  const posts = { findOne: jest.fn().mockReturnValue(chain) };
  const comments = {
    findVisibleComments: jest.fn().mockResolvedValue({
      comments: options.comments ?? [FIRST, SECOND],
      total: options.total ?? 2,
    }),
  };
  const publishedPosts = {
    authorNamesOf: jest.fn().mockResolvedValue(
      options.names ??
        new Map([
          [SARA.toString(), 'Sara Ahmed'],
          [OMAR.toString(), 'Omar Ali'],
        ]),
    ),
  };
  const service = new PostPageService(
    posts as unknown as Model<BlogPost>,
    comments as unknown as CommentsService,
    publishedPosts as unknown as PublishedPostsService,
  );
  return { service, posts, chain, comments, publishedPosts };
}

const queryOf = (overrides: Partial<PostPageQueryDto> = {}): PostPageQueryDto =>
  Object.assign(new PostPageQueryDto(), overrides);

describe('PostPageService (BLG-02)', () => {
  it('looks the post up as the public sees it: published, not hidden, with no viewer', async () => {
    const { service, posts, chain } = setup();

    await service.findPage(POST_ID, queryOf());

    expect(posts.findOne).toHaveBeenCalledWith(visiblePublishedPost(POST_ID));
    expect(chain.select).toHaveBeenCalledWith(
      'authorId title body tags images publishedAt likeCount commentCount',
    );
  });

  it('returns the post with its first page of comments and the author names', async () => {
    const { service } = setup();

    const page = await service.findPage(POST_ID, queryOf());

    expect(page).toMatchObject({
      id: POST_ID,
      title: 'Three days in Cairo',
      author: { id: SARA.toString(), name: 'Sara Ahmed' },
      publishedAt: '2026-11-15T10:00:00.000Z',
      body: 'The whole body',
      tags: ['cairo'],
      images: ['a.jpg'],
      likeCount: 3,
      commentCount: 2,
    });
    expect(page.comments.items.map((item) => item.body)).toEqual([
      'First',
      'Second',
    ]);
    expect(page.comments.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('reads the comments page the caller asked for, without checking the post a second time', async () => {
    const { service, comments } = setup();

    const page = await service.findPage(
      POST_ID,
      queryOf({ commentsPage: 3, commentsLimit: 5 }),
    );

    const [id, pagination] = comments.findVisibleComments.mock
      .calls[0] as unknown as [string, PaginationQueryDto];
    expect(id).toBe(POST_ID);
    expect(pagination).toBeInstanceOf(PaginationQueryDto);
    expect(pagination).toMatchObject({ page: 3, limit: 5 });
    expect(page.comments.meta).toMatchObject({ page: 3, limit: 5 });
  });

  it('reads the names of the post author and of every commenter in one query', async () => {
    const { service, publishedPosts } = setup();

    await service.findPage(POST_ID, queryOf());

    expect(publishedPosts.authorNamesOf).toHaveBeenCalledTimes(1);
    expect(publishedPosts.authorNamesOf).toHaveBeenCalledWith([
      SARA,
      OMAR,
      GONE,
    ]);
  });

  it('shows "Deleted user" for an author and a commenter without a name to show', async () => {
    const { service } = setup({
      post: storedPost({ authorId: GONE }),
      names: new Map([[OMAR.toString(), 'Omar Ali']]),
    });

    const page = await service.findPage(POST_ID, queryOf());

    expect(page.author).toEqual({
      id: GONE.toString(),
      name: DELETED_USER_NAME,
    });
    expect(page.comments.items.map((item) => item.author.name)).toEqual([
      'Omar Ali',
      DELETED_USER_NAME,
    ]);
  });

  it('shows 0 for counters a post stored before they existed does not have', async () => {
    const { service } = setup({
      post: storedPost({ likeCount: undefined, commentCount: undefined }),
    });

    const page = await service.findPage(POST_ID, queryOf());

    expect(page.likeCount).toBe(0);
    expect(page.commentCount).toBe(0);
  });

  it('answers an empty page of comments for a post without any', async () => {
    const { service } = setup({ comments: [], total: 0 });

    const page = await service.findPage(POST_ID, queryOf());

    expect(page.comments).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('answers a page past the last one with no comments but the real total', async () => {
    const { service } = setup({ comments: [], total: 2 });

    const page = await service.findPage(
      POST_ID,
      queryOf({ commentsPage: 9, commentsLimit: 5 }),
    );

    expect(page.comments.items).toEqual([]);
    expect(page.comments.meta).toEqual({
      page: 9,
      limit: 5,
      total: 2,
      totalPages: 1,
    });
  });

  it('answers 404 "Post not found" when no visible published post matches: missing, draft or hidden', async () => {
    const { service, publishedPosts } = setup({ post: null });

    await expect(service.findPage(POST_ID, queryOf())).rejects.toThrow(
      new NotFoundException('Post not found'),
    );
    // Nothing about a post that cannot be shown is read further.
    expect(publishedPosts.authorNamesOf).not.toHaveBeenCalled();
  });

  it('tells a draft, a hidden post and a missing post apart by nothing: one message', async () => {
    const { service } = setup({ post: null });

    const errors = await Promise.all(
      [POST_ID, '6740f1c2a4b5c6d7e8f90abd', '6740f1c2a4b5c6d7e8f90abe'].map(
        (id) =>
          service.findPage(id, queryOf()).catch((error: unknown) => error),
      ),
    );

    for (const error of errors) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe('Post not found');
    }
  });

  it('starts both reads before waiting for either', async () => {
    const { service, posts, comments } = setup();

    const pending = service.findPage(POST_ID, queryOf());

    // Both were called synchronously, before the first await resolved.
    expect(posts.findOne).toHaveBeenCalledTimes(1);
    expect(comments.findVisibleComments).toHaveBeenCalledTimes(1);
    await pending;
  });
});
