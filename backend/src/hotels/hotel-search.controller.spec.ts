import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import type { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import { HotelSearchController } from './hotel-search.controller';
import type { HotelSearchService } from './hotel-search.service';

describe('HotelSearchController (HTL-11, HTL-12)', () => {
  it('passes the query to the service and returns its page', async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { search: jest.fn().mockResolvedValue(page) };
    const controller = new HotelSearchController(
      service as unknown as HotelSearchService,
    );
    const query = {
      cityId: 'cairo',
      checkIn: '2026-12-20',
      checkOut: '2026-12-23',
      guests: 2,
      rooms: 1,
    } as SearchHotelsQueryDto;

    expect(await controller.search(query)).toBe(page);
    expect(service.search).toHaveBeenCalledWith(query);
  });

  it('passes the HTL-12 filters and order to the service unchanged', async () => {
    const service = { search: jest.fn().mockResolvedValue({ items: [] }) };
    const controller = new HotelSearchController(
      service as unknown as HotelSearchService,
    );
    const query = {
      cityId: 'cairo',
      checkIn: '2026-12-20',
      checkOut: '2026-12-23',
      guests: 2,
      rooms: 1,
      minPrice: 5000,
      maxPrice: 20000,
      minRating: 4.5,
      sortBy: 'rating',
      sortOrder: 'asc',
    } as SearchHotelsQueryDto;

    await controller.search(query);

    expect(service.search).toHaveBeenCalledWith(query);
  });

  it('is open to guests', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        HotelSearchController.prototype.search,
      ),
    ).toBe(true);
  });
});
