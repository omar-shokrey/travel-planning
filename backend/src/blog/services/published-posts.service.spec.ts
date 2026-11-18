import { Types } from 'mongoose';
import { PublishedPostsService } from './published-posts.service';

describe('PublishedPostsService', () => {
  const posts = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  let service: PublishedPostsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PublishedPostsService(posts as never);
  });

  it('should build the published-post filter correctly', () => {
    expect(service.publishedFilter()).toEqual({
      status: 'published',
      moderation: 'visible',
      authorDeactivated: false,
      publishedAt: { $exists: true },
    });
  });

  it('should query posts for the requested author with pagination and newest-first ordering', async () => {
    const authorId = new Types.ObjectId();

    const post = {
      _id: new Types.ObjectId(),
      authorId,
      title: 'My Travel Story',
      publishedAt: new Date('2026-01-15T10:00:00.000Z'),
    };

    const lean = jest.fn().mockResolvedValue([post]);

    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean,
    };

    posts.find.mockReturnValue(query);
    posts.countDocuments.mockResolvedValue(3);

    const result = await service.findByAuthor(authorId, 2, 1);

    expect(posts.find).toHaveBeenCalledWith({
      status: 'published',
      moderation: 'visible',
      authorDeactivated: false,
      publishedAt: { $exists: true },
      authorId,
    });

    expect(query.sort).toHaveBeenCalledWith({
      publishedAt: -1,
      _id: -1,
    });
    expect(query.skip).toHaveBeenCalledWith(1);
    expect(query.limit).toHaveBeenCalledWith(1);

    expect(result).toEqual({
      items: [
        {
          id: post._id.toString(),
          authorId: authorId.toString(),
          title: 'My Travel Story',
          publishedAt: '2026-01-15T10:00:00.000Z',
        },
      ],
      meta: {
        page: 2,
        limit: 1,
        total: 3,
        totalPages: 3,
      },
    });
  });
});
