import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostStatus } from './models/post-status.enum';

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
});
