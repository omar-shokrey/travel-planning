import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { HotelReviewResponseDto } from './dto/hotel-review-response.dto';
import { DELETED_AUTHOR_NAME } from './hotels.constants';
import { HotelReviewsListService } from './hotel-reviews-list.service';

/** The public reviews of a hotel (HTL-24). */
@ApiTags('hotels')
@Controller('hotels')
export class HotelReviewsListController {
  constructor(private readonly reviews: HotelReviewsListService) {}

  @Get(':id/reviews')
  @Public()
  @ApiOperation({
    summary: 'Reviews of a hotel (HTL-24)',
    description: `HTL-24. For guests and users. The visible reviews of an active hotel, newest first, 10 per page by default. Each shows the rating (1 to 5), the text when there is one, the author's name ("${DELETED_AUTHOR_NAME}" for a deactivated or deleted account, ACC-12) and when it was written. The average rating and the number of ratings are on the hotel page, GET /api/hotels/{id}.`,
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiPaginatedResponse(HotelReviewResponseDto)
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id, page or limit is not a whole number in range, or a parameter this list does not have',
  })
  @ApiNotFoundResponse({
    description: 'The hotel does not exist or is deactivated',
  })
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<HotelReviewResponseDto>> {
    return this.reviews.list(id, query);
  }
}
