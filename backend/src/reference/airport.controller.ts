import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AirportService } from './airport.service';

@ApiTags('airports')
@Controller('airports')
export class AirportController {
  constructor(private readonly airportService: AirportService) {}

  @Get()
  @ApiOperation({
    summary: 'List airports',
    description: 'Returns the read-only reference airport list.',
  })
  findAll(@Query() query: PaginationQueryDto) {
    return this.airportService.findAll(query);
  }
}
