import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AirportsService } from './airports.service';
import { AirportResponseDto } from './dto/airport-response.dto';

@ApiTags('Airports')
@Controller('airports')
export class AirportsController {
  constructor(private readonly airports: AirportsService) {}

  /** Public: guests search flights (FLT-11) and need the airports to choose from. */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'List the airports',
    description:
      'FLT-02. The predefined, read-only list of airports loaded at setup: IATA code, name, city, country and IANA time zone, sorted by IATA code. Open to guests.',
  })
  @ApiPaginatedResponse(AirportResponseDto)
  @ApiBadRequestResponse({ description: 'page or limit is invalid' })
  findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<AirportResponseDto>> {
    return this.airports.findAll(query);
  }
}
