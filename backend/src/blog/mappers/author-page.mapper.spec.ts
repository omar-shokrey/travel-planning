import { Types } from 'mongoose';
import type { PublicItineraryResponseDto } from '../../itineraries/dto/public-itinerary-response.dto';
import type { PostSummaryResponseDto } from '../dto/post-summary-response.dto';
import { toAuthorPage, type AuthorPageSource } from './author-page.mapper';

const authorId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90001');

const post = { id: 'p1', title: 'Cairo' } as PostSummaryResponseDto;
const itinerary = { id: 'i1', title: 'Egypt' } as PublicItineraryResponseDto;
const meta = (total: number) => ({
  page: 1,
  limit: 10,
  total,
  totalPages: total === 0 ? 0 : 1,
});

describe('toAuthorPage (BLG-12)', () => {
  it('maps the author and both pages to the public answer', () => {
    const page = toAuthorPage(
      {
        _id: authorId,
        name: 'Sara Ahmed',
        createdAt: new Date('2026-03-02T11:15:00+02:00'),
      },
      { items: [post], meta: meta(1) },
      { items: [], meta: meta(0) },
    );

    expect(page).toEqual({
      id: '6740f1c2a4b5c6d7e8f90001',
      name: 'Sara Ahmed',
      joinedAt: '2026-03-02T09:15:00.000Z',
      posts: { items: [post], meta: meta(1) },
      itineraries: { items: [], meta: meta(0) },
    });
  });

  it('keeps only the whitelisted fields, whatever the source carries', () => {
    const source = {
      _id: authorId,
      name: 'Sara Ahmed',
      createdAt: new Date('2026-03-02T09:15:00.000Z'),
      email: 'sara@example.com',
      phone: '+201000000000',
      role: 'user',
      status: 'active',
      preferredCurrency: 'EGP',
      passwordHash: 'hash',
      failedLoginAttempts: 2,
    } as AuthorPageSource;
    const posts = { items: [post], meta: meta(1), extra: 'x' };
    const itineraries = { items: [itinerary], meta: meta(1), extra: 'x' };

    const page = toAuthorPage(source, posts, itineraries);

    expect(Object.keys(page).sort()).toEqual([
      'id',
      'itineraries',
      'joinedAt',
      'name',
      'posts',
    ]);
    expect(Object.keys(page.posts).sort()).toEqual(['items', 'meta']);
    expect(Object.keys(page.itineraries).sort()).toEqual(['items', 'meta']);
  });
});
