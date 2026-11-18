import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import {
  PublicItineraryDetailResponseDto,
  PublicItineraryResponseDto,
} from './dto/public-itinerary-response.dto';
import { SearchPublicItinerariesQueryDto } from './dto/search-public-itineraries-query.dto';
import { PublicItinerariesService } from './public-itineraries.service';

/**
 * ITN-21. The two read routes are public and sit under /api/itineraries/public/,
 * the only public part of /api/itineraries (see test/guest-access.e2e-spec.ts).
 * Clone needs a login as a registered user (ITN-21): administrators and
 * moderators cannot use itineraries, so it gets 403 for them. The role is set
 * on the clone route only, not on the class, so the two reads stay open to
 * guests.
 */
@ApiTags('Itineraries')
@Controller('itineraries')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  // Declared before 'public/:id', or "search" would be taken for an id.
  @Public()
  @Get('public/search')
  @ApiOperation({
    summary: 'Search public itineraries',
    description:
      'ITN-21. Open to guests. Public itineraries only, most recently updated first, each with its author. q matches part of the title, a country (code or name) or the name of a city on any day. Filters: minDays and maxDays (duration), country (code) and city (city id). An itinerary set to private leaves the results at once (ITN-20).',
  })
  @ApiPaginatedResponse(PublicItineraryResponseDto)
  @ApiBadRequestResponse({
    description:
      'A query value is invalid or unknown, or minDays is greater than maxDays',
  })
  search(
    @Query() query: SearchPublicItinerariesQueryDto,
  ): Promise<PaginatedResponse<PublicItineraryResponseDto>> {
    return this.publicItineraries.search(query);
  }

  @Public()
  @Get('public/:id')
  @ApiOperation({
    summary: 'Open a public itinerary',
    description:
      'ITN-21. Open to guests. A public itinerary, read-only, with its author, days, activities, transport costs and city groups with their budget.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: PublicItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiNotFoundResponse({
    description: 'No public itinerary has this id (it may be private)',
  })
  findPublic(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PublicItineraryDetailResponseDto> {
    return this.publicItineraries.findPublic(id);
  }

  @Post(':id/clone')
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Clone a public itinerary',
    description:
      'ITN-21. Copy a public itinerary into your own itineraries, with all its days, activities, budget entries and transport costs. The copy is private, credits the original author (clonedFrom) and is independent: later changes to either one do not affect the other.',
  })
  @ApiParam({ name: 'id', description: 'Id of the public itinerary' })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description:
      'Not a registered user: administrators and moderators cannot use itineraries',
  })
  @ApiNotFoundResponse({
    description: 'No public itinerary has this id (it may be private)',
  })
  clone(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.publicItineraries.clone(id, userId);
  }
}
