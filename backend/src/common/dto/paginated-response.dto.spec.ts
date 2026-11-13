import { paginate } from './paginated-response.dto';

describe('paginate', () => {
  it('describes the page and rounds the page count up', () => {
    expect(paginate(['a', 'b'], 25, { page: 2, limit: 10 })).toEqual({
      items: ['a', 'b'],
      meta: { page: 2, limit: 10, total: 25, totalPages: 3 },
    });
  });

  it('has no pages when nothing matches (GEN-04)', () => {
    expect(paginate([], 0, { page: 1, limit: 10 })).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });
});
