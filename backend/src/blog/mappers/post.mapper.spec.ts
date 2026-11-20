import { Types } from 'mongoose';
import { PostModeration } from '../models/post-moderation.enum';
import { PostStatus } from '../models/post-status.enum';
import { toMyPostResponse, toPostResponse } from './post.mapper';

describe('toPostResponse', () => {
  it('maps a blog post document to a response DTO', () => {
    const post = {
      _id: { toString: () => 'post-1' },
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
      publishedAt: '2026-11-15T10:00:00.000Z',
      tags: ['cairo', 'egypt'],
      images: ['cairo.jpg'],
      itineraryId: null,
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
  });

  it('maps a draft post without publishedAt', () => {
    const post = {
      _id: { toString: () => 'post-2' },
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
      itineraryId: null,
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
  });

  it('returns every moment as a UTC ISO string, whatever the offset it was stored with', () => {
    const post = {
      _id: { toString: () => 'post-3' },
      authorId: { toString: () => '507f1f77bcf86cd799439011' },
      title: 'Offsets',
      body: 'Body',
      status: PostStatus.Published,
      publishedAt: new Date('2026-11-15T12:00:00.000+02:00'),
      tags: [],
      images: [],
      createdAt: new Date('2026-11-15T12:00:00.000+02:00'),
      updatedAt: new Date('2026-11-15T12:00:00.000+02:00'),
    };

    const response = toPostResponse(post as never);

    expect(response.publishedAt).toBe('2026-11-15T10:00:00.000Z');
    expect(response.createdAt).toBe('2026-11-15T10:00:00.000Z');
    expect(response.updatedAt).toBe('2026-11-15T10:00:00.000Z');
  });

  it('reads the id from _id, so a lean post maps too', () => {
    const lean = {
      _id: { toString: () => '6740f1c2a4b5c6d7e8f90abc' },
      authorId: { toString: () => '507f1f77bcf86cd799439011' },
      title: 'Lean',
      body: 'Body',
      status: PostStatus.Draft,
      tags: [],
      images: [],
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    };

    expect(toPostResponse(lean as never).id).toBe('6740f1c2a4b5c6d7e8f90abc');
  });

  it('gives the attached itinerary id as a string, and null for a post stored before BLG-13', () => {
    const itineraryId = new Types.ObjectId();
    const post = {
      _id: new Types.ObjectId(),
      authorId: new Types.ObjectId(),
      title: 'With a trip',
      body: 'Body',
      status: PostStatus.Draft,
      tags: [],
      images: [],
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    };

    expect(toPostResponse({ ...post, itineraryId } as never).itineraryId).toBe(
      itineraryId.toString(),
    );
    expect(toPostResponse(post as never).itineraryId).toBeNull();
  });

  describe('toMyPostResponse (BLG-03)', () => {
    const stored = {
      _id: { toString: () => '6740f1c2a4b5c6d7e8f90abc' },
      authorId: { toString: () => '507f1f77bcf86cd799439011' },
      title: 'Three days in Cairo',
      body: 'A long body that the list does not show.',
      status: PostStatus.Published,
      moderation: PostModeration.Visible,
      publishedAt: new Date('2026-11-15T12:00:00.000+02:00'),
      tags: ['cairo'],
      images: ['cairo.jpg'],
      likeCount: 4,
      commentCount: 2,
      createdAt: new Date('2026-11-14T12:00:00.000+02:00'),
      updatedAt: new Date('2026-11-15T12:00:00.000+02:00'),
    };

    it('returns the title, status, dates and the like and comment counts', () => {
      expect(toMyPostResponse(stored as never)).toEqual({
        id: '6740f1c2a4b5c6d7e8f90abc',
        title: 'Three days in Cairo',
        status: PostStatus.Published,
        moderation: PostModeration.Visible,
        publishedAt: '2026-11-15T10:00:00.000Z',
        itineraryId: null,
        createdAt: '2026-11-14T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
        likeCount: 4,
        commentCount: 2,
      });
    });

    it('leaves out the body, the tags and the images, which the list does not show', () => {
      const keys = Object.keys(toMyPostResponse(stored as never));

      expect(keys).not.toContain('body');
      expect(keys).not.toContain('tags');
      expect(keys).not.toContain('images');
      expect(keys).not.toContain('authorId');
    });

    it('tells the author that an admin hid the post (GEN-10)', () => {
      const hidden = { ...stored, moderation: PostModeration.Hidden };

      expect(toMyPostResponse(hidden as never).moderation).toBe('hidden');
    });

    it('gives the attached itinerary id, or null when none is (BLG-13)', () => {
      const itineraryId = new Types.ObjectId();

      expect(
        toMyPostResponse({ ...stored, itineraryId } as never).itineraryId,
      ).toBe(itineraryId.toString());
      expect(toMyPostResponse(stored as never).itineraryId).toBeNull();
    });

    it('leaves out publishedAt for a draft', () => {
      const draft = {
        ...stored,
        status: PostStatus.Draft,
        publishedAt: undefined,
      };

      expect(toMyPostResponse(draft as never)).not.toHaveProperty(
        'publishedAt',
      );
    });
  });
});
