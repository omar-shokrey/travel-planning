import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
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
