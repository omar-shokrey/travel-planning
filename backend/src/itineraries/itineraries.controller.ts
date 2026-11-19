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
  ApiConflictResponse,
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
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AddDayDto } from './dto/add-day.dto';
import { BudgetSummaryResponseDto } from './dto/budget-summary-response.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { CreateBudgetEntryDto } from './dto/create-budget-entry.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { ItineraryResponseDto } from './dto/itinerary-response.dto';
import { MoveDayDto } from './dto/move-day.dto';
import { UpdateDayDto } from './dto/update-day.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ActivitiesService } from './activities.service';
import { BudgetsService } from './budgets.service';
import { ItinerariesService } from './itineraries.service';
import { TransportCostsService } from './transport-costs.service';

@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@ApiForbiddenResponse({
  description:
    'Not a registered user: administrators and moderators cannot use itineraries',
})
@Roles(Role.User)
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly activities: ActivitiesService,
    private readonly transportCosts: TransportCostsService,
    private readonly budgets: BudgetsService,
  ) {}

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
      'ITN-03. The full details of your own itinerary: its fields and its days in order, each with its number and date. ITN-18: every budget amount (budget entries, activity costs, transport costs, city-group subtotals) also has `converted`, the same money in your preferred currency (USD when you have none), at the daily rates named in `conversion`.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.budgets.findOneConverted(id, userId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit an itinerary',
    description:
      'ITN-01, ITN-20. Edit the title, the countries or the start date of your own itinerary, or set its visibility. A public itinerary appears in the shared search and is read-only to other users. Setting it private removes it from the search at once. Send only the fields that change; null is refused.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, a field is null, an unknown field was sent, or a country code is not in the country list',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
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
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.itineraries.remove(id, userId);
  }

  @Post(':id/days')
  @ApiOperation({
    summary: 'Add a day',
    description:
      'ITN-05. Add a day at the end of your own itinerary, with a city from the city list and optional notes. Days are numbered in order and each date follows from the start date. An itinerary has at most 60 days.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, an unknown field was sent, or the city is not in the city list',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  @ApiConflictResponse({ description: 'The itinerary already has 60 days' })
  addDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddDayDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.itineraries.addDay(id, dto, userId);
  }

  // Declared before ':id/days/:dayId', or "reorder" would be taken for a day id.
  @Patch(':id/days/reorder')
  @ApiOperation({
    summary: 'Move a day',
    description:
      'ITN-08. Move a day of your own itinerary to a new position (1 is the first day). The days in between shift by one place, and every day number, date and city group follows the new order. Returns the itinerary with its days in the new order.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, an unknown field was sent, or the position is after the last day',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: 'No itinerary has this id, or it has no day with this id',
  })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  moveDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: MoveDayDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.itineraries.moveDay(id, dto, userId);
  }

  @Patch(':id/days/:dayId')
  @ApiOperation({
    summary: 'Edit a day',
    description:
      'ITN-05. Edit the city or the notes of a day of your own itinerary. Send only the fields that change; null is refused. Send empty notes to clear them.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id or a field is invalid, a field is null, an unknown field was sent, or the city is not in the city list',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: 'No itinerary has this id, or it has no day with this id',
  })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  updateDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: UpdateDayDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.itineraries.updateDay(id, dayId, dto, userId);
  }

  @Delete(':id/days/:dayId')
  @ApiOperation({
    summary: 'Delete a day',
    description:
      'ITN-07. Delete a day of your own itinerary, after the user confirms it in the app. The days after it are renumbered and their dates and budget totals recalculated. Returns the itinerary with its remaining days.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'An id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: 'No itinerary has this id, or it has no day with this id',
  })
  removeDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.itineraries.removeDay(id, dayId, userId);
  }

  @Post(':id/days/:dayId/activities')
  @ApiOperation({
    summary: 'Add an activity to a day',
    description:
      'ITN-10. Add an activity to a day of your own itinerary: a name, and optionally a description, a time (HH:mm) and a cost with its currency. The cost counts under Activities in the budget. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id or a field is invalid, an unknown field was sent, a cost has no currency, or the currency is not supported',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: 'No itinerary has this id, or it has no day with this id',
  })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  addActivity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateActivityDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.activities.add(id, dayId, dto, userId);
  }

  @Post(':id/transport-costs')
  @ApiOperation({
    summary: 'Add a transport cost',
    description:
      'ITN-16. Add the cost of travelling between two cities to a day of your own itinerary: mode, from-city, to-city, amount, currency and day. It counts in the budget of that day. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, an unknown field was sent, a city is not in the city list, both cities are the same, or the currency is not supported',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: 'No itinerary has this id, or it has no day with this dayId',
  })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  addTransportCost(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateTransportCostDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.transportCosts.add(id, dto, userId);
  }

  @Post(':id/days/:dayId/budgets')
  @ApiOperation({
    summary: 'Add a budget entry to a day',
    description:
      'ITN-14. Add a budget entry to a day of your own itinerary: a category (food, accommodation, local_transport or activities), an amount in whole minor units and its currency. Intercity transport is a transport cost (ITN-16), not a category. A day has at most 50 entries. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id' })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id or a field is invalid, an unknown field was sent, the category is not one of the four, the amount is negative, not whole or too large, or the currency is not supported',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: 'No itinerary has this id, or it has no day with this id',
  })
  @ApiConflictResponse({
    description:
      'The day already has 50 budget entries, or the itinerary kept being changed by other requests at the same time',
  })
  addBudgetEntry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateBudgetEntryDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.budgets.add(id, dayId, dto, userId);
  }

  @Get(':id/budget-summary')
  @ApiOperation({
    summary: 'Budget summary of an itinerary',
    description:
      'ITN-14. The total budget of your own itinerary, by category and by day. Totals include budget entries, activity costs (under activities) and transport costs (under intercity_transport), each as one amount per currency. ITN-18: every total also has `converted`, the same money in your preferred currency (USD when you have none), at the daily exchange rates named in `conversion`.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: BudgetSummaryResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, public or not, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  budgetSummary(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<BudgetSummaryResponseDto> {
    return this.budgets.summary(id, userId);
  }
}
