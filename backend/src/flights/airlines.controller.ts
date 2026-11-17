import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import type { ImageFile } from '../uploads/uploads.types';
import { UploadImage } from '../uploads/decorators/upload-image.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';

import { AirlinesService } from './airlines.service';
import { AirlineResponseDto } from './dto/airline-response.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { UpdateCancellationPolicyDto } from './dto/update-cancellation-policy.dto';

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlinesService: AirlinesService) {}

  @Post()
  @Roles(Role.Admin)
  @ApiCookieAuth()
  @UploadImage('logo')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['name', 'code', 'logo'],
      properties: {
        name: { type: 'string', maxLength: 100, example: 'EgyptAir' },
        code: { type: 'string', maxLength: 10, example: 'MS' },
        logo: {
          type: 'string',
          format: 'binary',
          description: 'Required JPG or PNG logo, at most 5 MB',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Create an airline profile',
    description:
      'FLT-01. An admin creates an airline profile with a name, a unique code and a logo (one JPG or PNG image, at most 5 MB).',
  })
  @ApiCreatedResponse({
    type: AirlineResponseDto,
    description: 'Airline profile created successfully',
  })
  @ApiBadRequestResponse({
    description:
      'The profile fields or logo are invalid, or no logo was uploaded',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({
    description: 'Only administrators can create airline profiles',
  })
  @ApiConflictResponse({
    description: 'An airline with this code already exists',
  })
  @ApiPayloadTooLargeResponse({
    description: 'The logo exceeds the upload size limit',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The logo is not a JPG or PNG image',
  })
  create(
    @Body() dto: CreateAirlineDto,
    @UploadedFile() logo: ImageFile,
  ): Promise<AirlineResponseDto> {
    return this.airlinesService.create(dto, logo);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get an airline profile by ID',
    description:
      'FLT-01. Returns the profile of one airline: name, code, logo and whether it is active. Open to guests: no login is needed.',
  })
  @ApiOkResponse({
    type: AirlineResponseDto,
    description: 'Airline profile retrieved successfully',
  })
  @ApiBadRequestResponse({ description: 'The airline ID is invalid' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  findById(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<AirlineResponseDto> {
    return this.airlinesService.findById(id);
  }

  @Put(':id/cancellation-policy')
  @Roles(Role.AirlineModerator)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Set the cancellation policy of an assigned airline',
    description:
      'FLT-09. The airline moderator assigned to this airline sets its cancellation tiers. The list sent replaces the whole policy; an empty list means no refund. Each tier has a different `daysBefore` (a whole number of 0 or more) and a `refundPercent` from 0 to 100. A cancellation is refunded by the tier with the highest `daysBefore` that does not exceed the days remaining before departure, or 0% when none applies. The tiers are returned highest threshold first.',
  })
  @ApiOkResponse({
    type: AirlineResponseDto,
    description: 'The policy was saved. The airline is returned with it.',
  })
  @ApiBadRequestResponse({
    description:
      'The airline ID is invalid, `tiers` is missing or not a list, it has more than 20 tiers, two tiers have the same `daysBefore`, a number is negative, fractional or not a number, a refund is above 100, or the body has a field that is not allowed',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({
    description:
      'Only the airline moderator assigned to this airline can set its policy',
  })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  setCancellationPolicy(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCancellationPolicyDto,
    @CurrentUser('id') userId: string,
  ): Promise<AirlineResponseDto> {
    return this.airlinesService.setCancellationPolicy(id, userId, dto);
  }

  @Patch(':id')
  @Roles(Role.AirlineModerator)
  @ApiCookieAuth()
  @UploadImage('logo')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 100, example: 'EgyptAir' },
        code: { type: 'string', maxLength: 10, example: 'MS' },
        logo: {
          type: 'string',
          format: 'binary',
          description: 'Optional JPG or PNG logo, at most 5 MB',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Update an assigned airline profile',
    description:
      'FLT-01. The airline moderator assigned to this airline edits its name, code or logo. Send only the fields that change. A new logo replaces the old one.',
  })
  @ApiOkResponse({
    type: AirlineResponseDto,
    description: 'Airline profile updated successfully',
  })
  @ApiBadRequestResponse({
    description: 'The airline ID, profile fields, or logo are invalid',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({
    description: 'Only the assigned airline moderator can update this profile',
  })
  @ApiNotFoundResponse({ description: 'Airline or user not found' })
  @ApiConflictResponse({
    description: 'An airline with this code already exists',
  })
  @ApiPayloadTooLargeResponse({
    description: 'The logo exceeds the upload size limit',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The logo is not a JPG or PNG image',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAirlineDto,
    @UploadedFile() logo: ImageFile,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AirlineResponseDto> {
    return this.airlinesService.update(id, user.id, dto, logo);
  }
}
