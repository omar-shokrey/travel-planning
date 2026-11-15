import { PostsService } from './posts.service';
import { PostStatus } from './models/post-status.enum';

describe('PostsService', () => {
  it('creates a post for the authenticated user', async () => {
    const createdPost = {
      id: 'post-1',
      authorId: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Draft,
      tags: [],
      images: [],
    };

    const posts = {
      create: jest.fn().mockResolvedValue(createdPost),
    };

    const service = new PostsService(posts as never);

    const result = await service.create(
      {
        title: 'Three days in Cairo',
        body: 'I spent three amazing days exploring Cairo.',
      },
      '507f1f77bcf86cd799439011',
    );

    expect(posts.create).toHaveBeenCalledWith({
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      authorId: expect.anything(),
    });

    expect(result).toEqual({
      id: 'post-1',
      authorId: '507f1f77bcf86cd799439011',
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Draft,
      tags: [],
      images: [],
    });
  });

  it('creates a published post with tags', async () => {
    const createdPost = {
      id: 'post-2',
      authorId: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      title: 'Best places in Cairo',
      body: 'Here are some of my favorite places in Cairo.',
      status: PostStatus.Published,
      tags: ['cairo', 'egypt'],
      images: [],
    };

    const posts = {
      create: jest.fn().mockResolvedValue(createdPost),
    };

    const service = new PostsService(posts as never);

    const result = await service.create(
      {
        title: 'Best places in Cairo',
        body: 'Here are some of my favorite places in Cairo.',
        status: PostStatus.Published,
        tags: ['cairo', 'egypt'],
      },
      '507f1f77bcf86cd799439011',
    );

    expect(posts.create).toHaveBeenCalledWith({
      title: 'Best places in Cairo',
      body: 'Here are some of my favorite places in Cairo.',
      status: PostStatus.Published,
      tags: ['cairo', 'egypt'],
      authorId: expect.anything(),
    });

    expect(result).toEqual({
      id: 'post-2',
      authorId: '507f1f77bcf86cd799439011',
      title: 'Best places in Cairo',
      body: 'Here are some of my favorite places in Cairo.',
      status: PostStatus.Published,
      tags: ['cairo', 'egypt'],
      images: [],
    });
  });
});
