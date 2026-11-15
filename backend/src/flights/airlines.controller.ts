import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';

import { AirlinesService } from './airlines.service';
import { AirlineResponseDto } from './dto/airline-response.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

@ApiTags('Airlines')
@ApiCookieAuth()
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlinesService: AirlinesService) {}

  @Post()
  @Roles(Role.Admin)
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
  @UploadImage('logo')
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

  @Get(':id')
  @ApiOperation({
    summary: 'Get an airline profile by ID',
    description:
      'FLT-01. Returns the profile of one airline: name, code, logo and whether it is active.',
  })
  @ApiOkResponse({
    type: AirlineResponseDto,
    description: 'Airline profile retrieved successfully',
  })
  @ApiBadRequestResponse({ description: 'The airline ID is invalid' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  findById(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<AirlineResponseDto> {
    return this.airlinesService.findById(id);
  }

  @Patch(':id')
  @Roles(Role.AirlineModerator)
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
  @UploadImage('logo')
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
