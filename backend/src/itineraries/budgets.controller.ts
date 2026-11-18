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
import { BudgetsService } from './budgets.service';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { UpdateBudgetEntryDto } from './dto/update-budget-entry.dto';

/**
 * ITN-14: a budget entry is edited and deleted by its own id. Adding one is
 * under its day, and the summary under its itinerary.
 */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@ApiForbiddenResponse({
  description:
    'Not a registered user: administrators and moderators cannot use itineraries',
})
@Roles(Role.User)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a budget entry',
    description:
      'ITN-14. Edit the category, amount or currency of a budget entry in your own itinerary. Send only the fields that change; null is refused. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Budget entry id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id or a field is invalid, a field is null, an unknown field was sent, the amount is negative, not whole or too large, or the currency is not supported',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No budget entry has this id' })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateBudgetEntryDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.budgets.update(id, dto, userId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a budget entry',
    description:
      'ITN-14. Delete a budget entry of your own itinerary. It leaves the totals at once. Returns the itinerary with its days.',
  })
  @ApiParam({ name: 'id', description: 'Budget entry id' })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No budget entry has this id' })
  @ApiConflictResponse({
    description:
      'The itinerary was changed by another request at the same time',
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.budgets.remove(id, userId);
  }
}
