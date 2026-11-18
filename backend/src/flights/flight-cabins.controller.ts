import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { FlightResponseDto } from './dto/flight-response.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { FlightCabinsService } from './flight-cabins.service';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import {
  CABIN_BAG_WEIGHT_MAX_KG,
  CABIN_CHANGED_MESSAGE,
  CABIN_FREE_BAGS_MAX,
  CABIN_NOT_FOUND_MESSAGE,
  CABIN_PRICE_MAX,
  CABIN_SEATS_MAX,
  duplicateCabinMessage,
  EMPTY_CABIN_UPDATE_MESSAGE,
  FLIGHT_CHANGED_MESSAGE,
  FLIGHT_NOT_FOUND_MESSAGE,
  FLIGHT_NOT_SCHEDULED_MESSAGE,
  FOREIGN_FLIGHT_MESSAGE,
} from './flights.constants';
import { CabinClass } from './models/cabin-class.enum';

const FLIGHT_ID_PARAM = {
  name: 'id',
  description: 'Flight id',
  example: '6740f1c2a4b5c6d7e8f90456',
};
const CABIN_ID_PARAM = {
  name: 'cabinId',
  description: 'Cabin id, the `id` of a cabin in the flight',
  example: '6740f1c2a4b5c6d7e8f90789',
};

const FORBIDDEN = `Not an airline moderator, an airline moderator with no assigned airline, or "${FOREIGN_FLIGHT_MESSAGE}"`;

/** The cabin categories of a flight, managed by its airline's moderator (FLT-04). */
@ApiTags('Flights')
@ApiCookieAuth()
@ApiParam(FLIGHT_ID_PARAM)
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({ description: FORBIDDEN })
@Controller('flights')
export class FlightCabinsController {
  constructor(private readonly cabins: FlightCabinsService) {}

  @Post(':id/cabins')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary: 'Add a cabin category to a flight (FLT-04)',
    description: [
      `Airline moderators only, for a scheduled flight of the moderator's assigned airline. The body is the cabin category (\`economy\`, \`premium_economy\`, \`business\` or \`first\`), the seat count, the price of one seat in ${PLATFORM_CURRENCY} cents, the free bags per passenger and the maximum weight of one bag in kg. All are required.`,
      `Each category at most once per flight (409 otherwise). All numbers are whole numbers: seats from 1 to ${CABIN_SEATS_MAX}, price from 1 to ${CABIN_PRICE_MAX} cents, free bags from 0 to ${CABIN_FREE_BAGS_MAX}, bag weight from 1 to ${CABIN_BAG_WEIGHT_MAX_KG} kg (also when there is no free bag). The client never sends \`bookedSeats\`, \`heldSeats\`, \`currency\` or an id (400).`,
      'Answers the whole flight with its cabins. Each cabin shows `availableSeats`, never the internal seat counters.',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({
    type: FlightResponseDto,
    description:
      'The cabin was added. The answer is the flight with all its cabins.',
  })
  @ApiBadRequestResponse({
    description:
      'The flight id is not a valid id, or a field is missing, invalid or not allowed. `errors` lists each field with its messages.',
  })
  @ApiNotFoundResponse({
    description: `"${FLIGHT_NOT_FOUND_MESSAGE}", or "Airline not found": the moderator's assignment names an airline that no longer exists`,
  })
  @ApiConflictResponse({
    description: `"${FLIGHT_NOT_SCHEDULED_MESSAGE}" (cancelled or departed), "${duplicateCabinMessage(CabinClass.Economy)}" (the class sent is named), or "${FLIGHT_CHANGED_MESSAGE}" (the flight changed at the same moment)`,
  })
  addCabin(
    @Param('id', ParseObjectIdPipe) flightId: string,
    @Body() dto: CreateCabinDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightResponseDto> {
    return this.cabins.addCabin(flightId, dto, userId);
  }

  @Patch(':id/cabins/:cabinId')
  @Roles(Role.AirlineModerator)
  @ApiParam(CABIN_ID_PARAM)
  @ApiOperation({
    summary: 'Edit a cabin category of a flight (FLT-04, FLT-05)',
    description: [
      "Airline moderators only, for a scheduled flight of the moderator's assigned airline. Send only the fields to change: `totalSeats`, `price`, `freeBags`, `maxBagKg`. The category itself cannot be changed (sending `cabin` answers 400).",
      'The seat count cannot go below the seats already booked or held (400 on `totalSeats`). A new price applies to new bookings only: an existing booking keeps the price it was made at.',
      'Answers the whole flight with its cabins.',
    ].join('\n\n'),
  })
  @ApiOkResponse({
    type: FlightResponseDto,
    description:
      'The cabin was changed. The answer is the flight with all its cabins.',
  })
  @ApiBadRequestResponse({
    description: `An id is not a valid id, a field is invalid, null or not allowed (\`cabin\` included), the seat count is below the seats already booked or held, or no field was sent ("${EMPTY_CABIN_UPDATE_MESSAGE}")`,
  })
  @ApiNotFoundResponse({
    description: `"${FLIGHT_NOT_FOUND_MESSAGE}", "${CABIN_NOT_FOUND_MESSAGE}", or "Airline not found": the moderator's assignment names an airline that no longer exists`,
  })
  @ApiConflictResponse({
    description: `"${FLIGHT_NOT_SCHEDULED_MESSAGE}" (cancelled or departed), or "${CABIN_CHANGED_MESSAGE}" (a booking changed the cabin's seats three times in a row)`,
  })
  updateCabin(
    @Param('id', ParseObjectIdPipe) flightId: string,
    @Param('cabinId', ParseObjectIdPipe) cabinId: string,
    @Body() dto: UpdateCabinDto,
    @CurrentUser('id') userId: string,
  ): Promise<FlightResponseDto> {
    return this.cabins.updateCabin(flightId, cabinId, dto, userId);
  }
}
