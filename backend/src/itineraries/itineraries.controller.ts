import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { ItineraryResponseDto } from './dto/itinerary-response.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ItinerariesService } from './itineraries.service';

@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an itinerary',
    description:
      'ITN-01. Create an itinerary with a title (at most 100 characters), one or more countries from the country list and a start date. It belongs to the logged-in user and is private by default.',
  })
  @ApiCreatedResponse({ type: ItineraryResponseDto })
  @ApiBadRequestResponse({
    description:
      'A field is missing or invalid, an unknown field was sent, or a country code is not in the country list',
  })
  create(
    @Body() dto: CreateItineraryDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryResponseDto> {
    return this.itineraries.create(dto, userId);
  }

  @Get()
  @ApiOperation({
    summary: 'List my itineraries',
    description:
      'ITN-03. The itineraries of the logged-in user with their title, countries, start date, number of days and visibility, most recently updated first.',
  })
  @ApiPaginatedResponse(ItineraryResponseDto)
  @ApiBadRequestResponse({ description: 'page or limit is invalid' })
  findMine(
    @Query() query: PaginationQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<ItineraryResponseDto>> {
    return this.itineraries.findMine(query, userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Open one of my itineraries',
    description:
      'ITN-03. The full details of your own itinerary: its fields and its days in order, each with its number and date.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description: 'The itinerary belongs to another user',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.itineraries.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit an itinerary',
    description:
      'ITN-01. Edit the title, the countries or the start date of your own itinerary. Send only the fields that change.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, an unknown field was sent, or a country code is not in the country list',
  })
  @ApiForbiddenResponse({
    description: 'The itinerary belongs to another user',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateItineraryDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryResponseDto> {
    return this.itineraries.update(id, dto, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an itinerary',
    description:
      'ITN-01. Delete your own itinerary. It disappears from public search at once. Clones that other users made earlier are not affected.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiNoContentResponse({ description: 'The itinerary was deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description: 'The itinerary belongs to another user',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.itineraries.remove(id, userId);
  }
}
