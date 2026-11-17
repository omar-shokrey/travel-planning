import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { SearchPostsQueryDto } from './dto/search-posts-query.dto';
import { PostSearchController } from './post-search.controller';
import type { PublishedPostsService } from './published-posts.service';

const page = {
  items: [],
  meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
};

function setup() {
  const service = {
    search: jest.fn().mockResolvedValue(page),
    listNewest: jest.fn().mockResolvedValue(page),
  };
  const controller = new PostSearchController(
    service as unknown as PublishedPostsService,
  );
  return { service, controller };
}

describe('PostSearchController (BLG-09)', () => {
  it('searches when a keyword is given', async () => {
    const { service, controller } = setup();
    const query = Object.assign(new SearchPostsQueryDto(), { q: 'cairo' });

    await expect(controller.search(query)).resolves.toBe(page);
    expect(service.search).toHaveBeenCalledWith('cairo', query);
    expect(service.listNewest).not.toHaveBeenCalled();
  });

  it('lists the newest posts when no keyword is given', async () => {
    const { service, controller } = setup();
    const query = new SearchPostsQueryDto();

    await expect(controller.search(query)).resolves.toBe(page);
    expect(service.listNewest).toHaveBeenCalledWith(query);
    expect(service.search).not.toHaveBeenCalled();
  });

  it('is open to guests and needs no role', () => {
    const reflector = new Reflector();
    const handler = PostSearchController.prototype.search;

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
  });
});
