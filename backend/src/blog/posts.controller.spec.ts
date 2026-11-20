import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostStatus } from './models/post-status.enum';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';

/** The metadata key of @ApiResponse and its shortcuts, as the other controller specs read it. */
const API_RESPONSE = 'swagger/apiResponse';

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

  describe('update (BLG-04)', () => {
    it('passes the post id, update data, and authenticated user id to the service', async () => {
      const post = {
        id: 'post-1',
        authorId: '507f1f77bcf86cd799439011',
        title: 'Updated title',
        body: 'Updated body',
        status: PostStatus.Draft,
        tags: [],
        images: [],
      };

      const postsService = {
        update: jest.fn().mockResolvedValue(post),
      };

      const controller = new PostsController(
        postsService as unknown as PostsService,
      );

      const dto = {
        title: 'Updated title',
        body: 'Updated body',
      };

      expect(
        await controller.update('post-1', dto, '507f1f77bcf86cd799439011'),
      ).toBe(post);

      expect(postsService.update).toHaveBeenCalledWith(
        'post-1',
        dto,
        '507f1f77bcf86cd799439011',
      );
    });

    it('is for registered users only', () => {
      expect(
        new Reflector().get<Role[] | undefined>(
          ROLES_KEY,
          PostsController.prototype.update,
        ),
      ).toEqual([Role.User]);
    });
  });

  describe('remove (BLG-04)', () => {
    it('passes the post id and authenticated user id to the service', async () => {
      const postsService = {
        remove: jest.fn().mockResolvedValue(undefined),
      };

      const controller = new PostsController(
        postsService as unknown as PostsService,
      );

      await expect(
        controller.remove('post-1', '507f1f77bcf86cd799439011'),
      ).resolves.toBeUndefined();

      expect(postsService.remove).toHaveBeenCalledWith(
        'post-1',
        '507f1f77bcf86cd799439011',
      );
    });

    it('is for registered users only', () => {
      expect(
        new Reflector().get<Role[] | undefined>(
          ROLES_KEY,
          PostsController.prototype.remove,
        ),
      ).toEqual([Role.User]);
    });
  });

  describe('attachItinerary (BLG-13)', () => {
    it('passes the post id, the body and the logged-in user to the service', async () => {
      const post = { id: 'post-1', itineraryId: '6741c0ffee0ddba11ad0b0b0' };
      const postsService = {
        attachItinerary: jest.fn().mockResolvedValue(post),
      };
      const controller = new PostsController(
        postsService as unknown as PostsService,
      );
      const dto = { itineraryId: '6741c0ffee0ddba11ad0b0b0' };

      expect(
        await controller.attachItinerary(
          'post-1',
          dto,
          '507f1f77bcf86cd799439011',
        ),
      ).toBe(post);
      expect(postsService.attachItinerary).toHaveBeenCalledWith(
        'post-1',
        dto,
        '507f1f77bcf86cd799439011',
      );
    });

    it('is for registered users only', () => {
      expect(
        new Reflector().get<Role[] | undefined>(
          ROLES_KEY,
          PostsController.prototype.attachItinerary,
        ),
      ).toEqual([Role.User]);
    });

    it('documents 200 and every error status in Swagger', () => {
      const responses = Reflect.getMetadata(
        API_RESPONSE,
        PostsController.prototype.attachItinerary,
      ) as Record<string, unknown>;

      expect(Object.keys(responses).sort()).toEqual([
        '200',
        '400',
        '401',
        '403',
        '404',
        '409',
      ]);
    });
  });
});
