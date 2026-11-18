import { Types } from 'mongoose';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { AuthorPageQueryDto } from './dto/author-page-query.dto';
import { AuthorsController } from './authors.controller';

describe('AuthorsController', () => {
  const authorsService = {
    findAuthorPage: jest.fn(),
  };

  let controller: AuthorsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthorsController(authorsService as never);
  });

  it('should be marked as public', () => {
    const metadata = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      AuthorsController.prototype.getAuthorPage,
    );

    expect(metadata).toBe(true);
  });

  it('should pass the ObjectId and query to the service', async () => {
    const id = new Types.ObjectId().toString();

    const query: AuthorPageQueryDto = {
      postsPage: 2,
      postsLimit: 5,
      itinerariesPage: 3,
      itinerariesLimit: 4,
    };

    const response = {
      id,
      name: 'Salma',
      joinedAt: '2026-01-15T10:30:00.000Z',
      posts: {
        items: [],
        meta: {
          page: 2,
          limit: 5,
          total: 0,
          totalPages: 0,
        },
      },
      itineraries: {
        items: [],
        meta: {
          page: 3,
          limit: 4,
          total: 0,
          totalPages: 0,
        },
      },
    };

    authorsService.findAuthorPage.mockResolvedValue(response);

    await expect(controller.getAuthorPage(id, query)).resolves.toEqual(
      response,
    );

    expect(authorsService.findAuthorPage).toHaveBeenCalledWith(
      expect.objectContaining({
        _bsontype: 'ObjectId',
      }),
      query,
    );
  });
});
