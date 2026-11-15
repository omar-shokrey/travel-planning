import { PostStatus } from '../models/post-status.enum';
import { toPostResponse } from './post.mapper';

describe('toPostResponse', () => {
  it('maps a blog post document to a response DTO', () => {
    const post = {
      id: 'post-1',
      authorId: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Published,
      publishedAt: new Date('2026-11-15T10:00:00.000Z'),
      tags: ['cairo', 'egypt'],
      images: ['cairo.jpg'],
      createdAt: new Date('2026-11-14T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    };

    expect(toPostResponse(post as never)).toEqual({
      id: 'post-1',
      authorId: '507f1f77bcf86cd799439011',
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
      status: PostStatus.Published,
      publishedAt: new Date('2026-11-15T10:00:00.000Z'),
      tags: ['cairo', 'egypt'],
      images: ['cairo.jpg'],
      createdAt: new Date('2026-11-14T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    });
  });

  it('maps a draft post without publishedAt', () => {
    const post = {
      id: 'post-2',
      authorId: {
        toString: () => '507f1f77bcf86cd799439011',
      },
      title: 'Draft trip ideas',
      body: 'Some ideas for my next trip.',
      status: PostStatus.Draft,
      publishedAt: undefined,
      tags: [],
      images: [],
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    };

    expect(toPostResponse(post as never)).toEqual({
      id: 'post-2',
      authorId: '507f1f77bcf86cd799439011',
      title: 'Draft trip ideas',
      body: 'Some ideas for my next trip.',
      status: PostStatus.Draft,
      publishedAt: undefined,
      tags: [],
      images: [],
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    });
  });
});
