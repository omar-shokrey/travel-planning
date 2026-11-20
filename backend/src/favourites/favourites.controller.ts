import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AddFavouriteDto } from './dto/add-favourite.dto';
import { FavouriteResponseDto } from './dto/favourite-response.dto';
import { ListFavouritesQueryDto } from './dto/list-favourites-query.dto';
import {
  FAVOURITE_HOTEL_NOT_FOUND_MESSAGE,
  FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
  FAVOURITE_NOT_FOUND_MESSAGE,
  FAVOURITES_LIMIT_MESSAGE,
  FAVOURITES_MAX_PER_USER,
} from './favourites.constants';
import { FavouritesService } from './favourites.service';

const NOT_IN_SECTION_8 =
  'Section 8 of the project description has no favourites route; this one is the approved design of BON-02 (optional).';

/** BON-02: the favourites of the logged-in registered user. */
@ApiTags('favourites')
@ApiCookieAuth()
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Save a hotel or a public itinerary to my favourites (BON-02)',
    description: `Registered users only. The target must be visible to the public now: an active hotel, or a public itinerary that is not hidden and whose author is not deactivated. Saving the same target again changes nothing and answers 200 with the same favourite; the first time answers 201. At most ${FAVOURITES_MAX_PER_USER} favourites per user. ${NOT_IN_SECTION_8}`,
  })
  @ApiCreatedResponse({ type: FavouriteResponseDto, description: 'Saved' })
  @ApiOkResponse({
    type: FavouriteResponseDto,
    description: 'It was already saved: the same favourite',
  })
  @ApiBadRequestResponse({
    description:
      '`targetType` is not hotel or itinerary, `targetId` is not a valid id, or the body has another field',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description:
      'Not a registered user (administrators and moderators have no favourites), or the account is suspended',
  })
  @ApiNotFoundResponse({
    description: `"${FAVOURITE_HOTEL_NOT_FOUND_MESSAGE}": no such hotel, or it is deactivated. "${FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE}": no such itinerary, or it is private (even your own), hidden or its author is deactivated. "${FAVOURITE_NOT_FOUND_MESSAGE}": only when the same favourite, added by another request at the same moment, was removed before it could be read`,
  })
  @ApiConflictResponse({ description: `"${FAVOURITES_LIMIT_MESSAGE}"` })
  async add(
    @Body() dto: AddFavouriteDto,
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FavouriteResponseDto> {
    const { favourite, created } = await this.favourites.add(userId, dto);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return favourite;
  }

  @Get()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'My favourites (BON-02)',
    description: `Registered users only, their own favourites. Newest first, paginated (10 per page by default), optionally only hotels or only itineraries. Each one has the public card of its target; a target that is no longer visible to the public stays in the list with \`available: false\` and no card, so it can be removed. ${NOT_IN_SECTION_8}`,
  })
  @ApiPaginatedResponse(FavouriteResponseDto)
  @ApiBadRequestResponse({
    description:
      '`targetType` is not hotel or itinerary, the page parameters are wrong, or the query has a parameter the list does not have',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description: 'Not a registered user, or the account is suspended',
  })
  list(
    @Query() query: ListFavouritesQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<FavouriteResponseDto>> {
    return this.favourites.list(userId, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Remove one of my favourites (BON-02)',
    description: `Registered users only. The id is the favourite's own id. Another user's favourite is the same 404 as one that does not exist. ${NOT_IN_SECTION_8}`,
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description: 'Not a registered user, or the account is suspended',
  })
  @ApiNotFoundResponse({
    description: `"${FAVOURITE_NOT_FOUND_MESSAGE}": no such favourite, or it is another user's`,
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.favourites.remove(id, userId);
  }
}
