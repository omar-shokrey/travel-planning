import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { HotelReviewsListController } from './hotel-reviews-list.controller';
import type { HotelReviewsListService } from './hotel-reviews-list.service';

describe('HotelReviewsListController (HTL-24)', () => {
  it('passes the hotel id and the page to the service and returns its page', async () => {
    const result = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { list: jest.fn().mockResolvedValue(result) };
    const controller = new HotelReviewsListController(
      service as unknown as HotelReviewsListService,
    );
    const query = { page: 1, limit: 10 } as PaginationQueryDto;

    expect(await controller.list('h1', query)).toBe(result);
    expect(service.list).toHaveBeenCalledWith('h1', query);
  });

  it('is GET :id/reviews and open to guests', () => {
    const handler = HotelReviewsListController.prototype.list;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/reviews');
  });
});
