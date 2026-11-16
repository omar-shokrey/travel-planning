import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostStatus } from './models/post-status.enum';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';

describe('PostsController', () => {
  it('passes the post data and authenticated user id to the service', async () => {
    const post = {
      id: 'post-1',
      authorId: '507f1f77bcf86cd799439011',
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Draft,
      tags: [],
      images: [],
    };

    const postsService = {
      create: jest.fn().mockResolvedValue(post),
    };

    const controller = new PostsController(
      postsService as unknown as PostsService,
    );

    const dto = {
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
    };

    expect(await controller.create(dto, '507f1f77bcf86cd799439011')).toBe(post);

    expect(postsService.create).toHaveBeenCalledWith(
      dto,
      '507f1f77bcf86cd799439011',
    );
  });

  describe('listMine (BLG-03)', () => {
    it('gives the service the logged-in user and the page, and returns its answer', async () => {
      const page = {
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      };
      const postsService = { listMine: jest.fn().mockResolvedValue(page) };
      const controller = new PostsController(
        postsService as unknown as PostsService,
      );
      const query = new PaginationQueryDto();

      expect(await controller.listMine('507f1f77bcf86cd799439011', query)).toBe(
        page,
      );
      expect(postsService.listMine).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        query,
      );
    });

    it('is for registered users only, like creating a post', () => {
      expect(
        new Reflector().get<Role[] | undefined>(
          ROLES_KEY,
          PostsController.prototype.listMine,
        ),
      ).toEqual([Role.User]);
    });
  });
});
