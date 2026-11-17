import { Types, type Model } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { User } from '../users/models/user.schema';
import { DELETED_USER_NAME, SEARCH_AUTHORS_MAX_COUNT } from './blog.constants';
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
  const aggregateExec = jest.fn().mockResolvedValue(stored);
  const posts = {
    find: jest.fn(() => postsQuery),
    aggregate: jest.fn(() => ({ exec: aggregateExec })),
    countDocuments: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(stored.length),
    })),
  };
  const users = { find: jest.fn(() => usersQuery) };
  const service = new PublishedPostsService(
    posts as unknown as Model<BlogPost>,
    users as unknown as Model<User>,
  );
  return { posts, postsQuery, users, usersQuery, service };
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

  describe('listNewest (BLG-09 without a keyword)', () => {
    it('lists every published post, newest first', async () => {
      const { posts, postsQuery, service } = setup();

      await service.listNewest(new PaginationQueryDto());

      expect(posts.find).toHaveBeenCalledWith({ status: PostStatus.Published });
      expect(postsQuery.sort).toHaveBeenCalledWith({
        publishedAt: -1,
        _id: -1,
      });
    });
  });

  describe('search (BLG-09)', () => {
    // The dot of the keyword is escaped, so it matches only a dot.
    const pattern = { $regex: 'cai\\.ro', $options: 'i' };

    it('finds the matching authors by name first, active registered users only', async () => {
      const { users, usersQuery, service } = setup();

      await service.search('cai.ro', new PaginationQueryDto());

      expect(users.find).toHaveBeenNthCalledWith(1, {
        role: Role.User,
        status: { $ne: UserStatus.Deactivated },
        name: pattern,
      });
      expect(usersQuery.sort).toHaveBeenCalledWith({ _id: 1 });
      expect(usersQuery.limit).toHaveBeenCalledWith(SEARCH_AUTHORS_MAX_COUNT);
    });

    it('matches the title, the tags or the posts of those authors, published only, with the keyword escaped', async () => {
      const { posts, service } = setup();

      await service.search('cai.ro', new PaginationQueryDto());

      const match = {
        status: PostStatus.Published,
        $or: [
          { title: pattern },
          { tags: pattern },
          { authorId: { $in: [sara] } },
        ],
      };
      expect(posts.countDocuments).toHaveBeenCalledWith(match);
      const [pipeline] = posts.aggregate.mock.calls[0] as unknown as [
        Record<string, unknown>[],
      ];
      expect(pipeline[0]).toEqual({ $match: match });
    });

    it('leaves the author condition out when no author name matches', async () => {
      const { posts, usersQuery, service } = setup();
      usersQuery.exec.mockResolvedValueOnce([]);

      await service.search('nobody', new PaginationQueryDto());

      expect(posts.countDocuments).toHaveBeenCalledWith({
        status: PostStatus.Published,
        $or: [
          { title: { $regex: 'nobody', $options: 'i' } },
          { tags: { $regex: 'nobody', $options: 'i' } },
        ],
      });
    });

    it('orders by likes plus comments, then newest first, then id, and pages', async () => {
      const { posts, service } = setup();
      const query = Object.assign(new PaginationQueryDto(), {
        page: 3,
        limit: 4,
      });

      await service.search('cairo', query);

      const [pipeline] = posts.aggregate.mock.calls[0] as unknown as [
        Record<string, unknown>[],
      ];
      expect(pipeline.slice(1, 5)).toEqual([
        {
          $addFields: {
            score: {
              $add: [
                { $ifNull: ['$likeCount', 0] },
                { $ifNull: ['$commentCount', 0] },
              ],
            },
          },
        },
        { $sort: { score: -1, publishedAt: -1, _id: -1 } },
        { $skip: 8 },
        { $limit: 4 },
      ]);
    });

    it('returns summary rows and the total of all matches', async () => {
      const { service } = setup();

      const page = await service.search('cairo', new PaginationQueryDto());

      expect(page.items).toHaveLength(1);
      expect(page.items[0].author.name).toBe('Sara Ahmed');
      expect(page.meta.total).toBe(1);
    });
  });
});
