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
import { ActivitiesService } from './activities.service';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

/** ITN-10: an activity is edited and deleted by its own id. Adding one is under its day. */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@ApiForbiddenResponse({
  description:
    'Not a registered user: administrators and moderators cannot use itineraries',
})
@Roles(Role.User)
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit an activity',
    description:
      'ITN-10. Edit the name, description, time or cost of an activity in your own itinerary. Send only the fields that change; an empty description or time removes it. A cost and its currency go together. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, a field is null, an unknown field was sent, a cost has no currency, or the currency is not supported',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No activity has this id' })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateActivityDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.activities.update(id, dto, userId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an activity',
    description:
      'ITN-10. Delete an activity of your own itinerary. Its cost leaves the budget totals. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No activity has this id' })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.activities.remove(id, userId);
  }
}
