import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AppService, type HealthStatus } from './app.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check that the API and its database are running' })
  @ApiOkResponse({
    description: 'The API and the database are working',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        database: { type: 'string', example: 'up' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'The database is not connected',
  })
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
