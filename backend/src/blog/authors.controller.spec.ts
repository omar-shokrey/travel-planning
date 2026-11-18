import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AuthorsController } from './authors.controller';
import type { AuthorsService } from './authors.service';
import { AuthorPageQueryDto } from './dto/author-page-query.dto';

describe('AuthorsController (BLG-12)', () => {
  it('gives the service the id and the query, and returns its answer', async () => {
    const page = { id: 'a1' };
    const service = { findPage: jest.fn().mockResolvedValue(page) };
    const controller = new AuthorsController(
      service as unknown as AuthorsService,
    );
    const query = new AuthorPageQueryDto();

    await expect(
      controller.findPage('6740f1c2a4b5c6d7e8f90001', query),
    ).resolves.toBe(page);
    expect(service.findPage).toHaveBeenCalledWith(
      '6740f1c2a4b5c6d7e8f90001',
      query,
    );
  });

  it('is open to guests and needs no role', () => {
    const reflector = new Reflector();
    const handler = AuthorsController.prototype.findPage;

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, AuthorsController)).toBeUndefined();
  });
});
