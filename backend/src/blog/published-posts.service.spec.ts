import { Types, type Model } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserStatus } from '../common/enums/user-status.enum';
import type { User } from '../users/models/user.schema';
import { DELETED_USER_NAME } from './blog.constants';
import type { BlogPost } from './models/blog-post.schema';
import { PostStatus } from './models/post-status.enum';
import { PublishedPostsService } from './published-posts.service';

const sara = new Types.ObjectId('6740f1c2a4b5c6d7e8f90001');
const gone = new Types.ObjectId('6740f1c2a4b5c6d7e8f90002');

const post = (id: string, authorId: Types.ObjectId) => ({
  _id: new Types.ObjectId(id),
  authorId,
  title: `Post ${id.slice(-1)}`,
  body: 'Body',
  tags: ['cairo'],
  publishedAt: new Date('2026-11-15T10:00:00.000Z'),
  likeCount: 1,
  commentCount: 0,
});

/** A chain like Mongoose's query: every step returns the chain, `exec` resolves. */
interface QueryChain {
  select: jest.Mock<QueryChain>;
  sort: jest.Mock<QueryChain>;
  skip: jest.Mock<QueryChain>;
  limit: jest.Mock<QueryChain>;
  lean: jest.Mock<QueryChain>;
  exec: jest.Mock;
}

function queryOf(result: unknown): QueryChain {
  const chain: QueryChain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function setup(stored = [post('6740f1c2a4b5c6d7e8f9aaa1', sara)]) {
  const postsQuery = queryOf(stored);
  const usersQuery = queryOf([{ _id: sara, name: 'Sara Ahmed' }]);
  const posts = {
    find: jest.fn(() => postsQuery),
    countDocuments: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(stored.length),
    })),
  };
  const users = { find: jest.fn(() => usersQuery) };
  const service = new PublishedPostsService(
    posts as unknown as Model<BlogPost>,
    users as unknown as Model<User>,
  );
  return { posts, postsQuery, users, service };
}

describe('PublishedPostsService', () => {
  describe('listByTag (BLG-08)', () => {
    it('lists only published posts that have the tag, newest first, one page', async () => {
      const { posts, postsQuery, service } = setup();
      const query = Object.assign(new PaginationQueryDto(), {
        page: 2,
        limit: 5,
      });

      await service.listByTag('cairo', query);

      const filter = { status: PostStatus.Published, tags: 'cairo' };
      expect(posts.find).toHaveBeenCalledWith(filter);
      expect(posts.countDocuments).toHaveBeenCalledWith(filter);
      expect(postsQuery.sort).toHaveBeenCalledWith({
        publishedAt: -1,
        _id: -1,
      });
      expect(postsQuery.skip).toHaveBeenCalledWith(5);
      expect(postsQuery.limit).toHaveBeenCalledWith(5);
    });

    it('returns rows with the author names and the total', async () => {
      const { service, users } = setup([
        post('6740f1c2a4b5c6d7e8f9aaa1', sara),
        post('6740f1c2a4b5c6d7e8f9aaa2', gone),
        post('6740f1c2a4b5c6d7e8f9aaa3', sara),
      ]);

      const page = await service.listByTag('cairo', new PaginationQueryDto());

      expect(users.find).toHaveBeenCalledTimes(1);
      expect(users.find).toHaveBeenCalledWith({
        _id: { $in: [sara, gone] },
        status: { $ne: UserStatus.Deactivated },
      });
      expect(page.items.map((item) => item.author.name)).toEqual([
        'Sara Ahmed',
        DELETED_USER_NAME,
        'Sara Ahmed',
      ]);
      expect(page.meta).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('answers an empty page, without asking for authors, when no post has the tag', async () => {
      const { service, users } = setup([]);

      const page = await service.listByTag('unused', new PaginationQueryDto());

      expect(page).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
      expect(users.find).not.toHaveBeenCalled();
    });
  });
});
