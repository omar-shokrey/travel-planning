import { Body, Controller, Delete, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';
import { TransportCostsService } from './transport-costs.service';

/** ITN-16: a transport cost is edited and deleted by its own id. Adding one is under its itinerary. */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@ApiForbiddenResponse({
  description:
    'Not a registered user: administrators and moderators cannot use itineraries',
})
@Roles(Role.User)
@Controller('transport-costs')
export class TransportCostsController {
  constructor(private readonly transportCosts: TransportCostsService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a transport cost',
    description:
      'ITN-16. Edit the mode, cities, amount, currency or day of a transport cost in your own itinerary. Send only the fields that change; a new dayId moves it to that day. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Transport cost id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, a field is null, an unknown field was sent, a city is not in the city list, both cities are the same, or the currency is not supported',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description:
      'No transport cost has this id, or the new day is not in its itinerary',
  })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTransportCostDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.transportCosts.update(id, dto, userId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a transport cost',
    description:
      'ITN-16. Delete a transport cost of your own itinerary. Its amount leaves the budget totals. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Transport cost id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No transport cost has this id' })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.transportCosts.remove(id, userId);
  }
}
