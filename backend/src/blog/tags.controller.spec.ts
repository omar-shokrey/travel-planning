import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { PublishedPostsService } from './published-posts.service';
import { TagsController } from './tags.controller';

describe('TagsController (BLG-08)', () => {
  it('gives the service the tag and the page, and returns its answer', async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { listByTag: jest.fn().mockResolvedValue(page) };
    const controller = new TagsController(
      service as unknown as PublishedPostsService,
    );
    const query = new PaginationQueryDto();

    await expect(controller.listByTag({ tag: 'cairo' }, query)).resolves.toBe(
      page,
    );
    expect(service.listByTag).toHaveBeenCalledWith('cairo', query);
  });

  it('is open to guests and needs no role', () => {
    const reflector = new Reflector();
    const handler = TagsController.prototype.listByTag;

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
  });
});
