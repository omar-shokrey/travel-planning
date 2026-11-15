import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AirportResponseDto } from './dto/airport-response.dto';
import { AirportService } from './airport.service';

@ApiTags('airports')
@Controller('airports')
export class AirportController {
  constructor(private readonly airportService: AirportService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List airports',
    description: 'FLT-02: Returns the read-only airport list.',
  })
  @ApiPaginatedResponse(AirportResponseDto)
  findAll(@Query() query: PaginationQueryDto) {
    return this.airportService.findAll(query);
  }
}
