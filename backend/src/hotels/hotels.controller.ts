import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFiles,
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
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UploadImages } from '../uploads/decorators/upload-images.decorator';
import type { ImageFile } from '../uploads/uploads.types';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelResponseDto } from './dto/hotel-response.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelsService } from './hotels.service';

@ApiTags('hotels')
@ApiCookieAuth()
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post()
  @Roles(Role.Admin)
  @ApiOperation({
    summary: 'Create a hotel profile',
    description:
      'HTL-01: An administrator creates a hotel profile. The country is copied from the selected reference city.',
  })
  @ApiCreatedResponse({
    description: 'The hotel profile was created',
    type: HotelResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'The profile is invalid or the city does not exist.',
  })
  @ApiUnauthorizedResponse({ description: 'You must log in to do this.' })
  @ApiForbiddenResponse({
    description: 'Only an administrator can create a hotel profile.',
  })
  create(@Body() dto: CreateHotelDto): Promise<HotelResponseDto> {
    return this.hotelsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Edit a hotel profile',
    description:
      'HTL-01: A hotel moderator edits the profile of their assigned hotel. Changing the city also refreshes the country.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({
    description: 'The hotel profile was updated',
    type: HotelResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The profile is invalid, the id is malformed, or the city does not exist.',
  })
  @ApiUnauthorizedResponse({ description: 'You must log in to do this.' })
  @ApiForbiddenResponse({
    description: 'The moderator is not assigned to this hotel.',
  })
  @ApiNotFoundResponse({ description: 'The hotel does not exist.' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentUser('id') userId: string,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.update(id, dto, userId);
  }

  @Post(':id/photos')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.HotelModerator)
  @UploadImages()
  @ApiOperation({
    summary: 'Add hotel photos',
    description:
      'HTL-01: A hotel moderator adds JPG or PNG photos to their assigned hotel. A hotel can have at most five photos.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({
    description: 'The hotel photos were added',
    type: HotelResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'No images were uploaded or adding them would exceed the five-photo limit.',
  })
  @ApiUnauthorizedResponse({ description: 'You must log in to do this.' })
  @ApiForbiddenResponse({
    description: 'The moderator is not assigned to this hotel.',
  })
  @ApiNotFoundResponse({ description: 'The hotel does not exist.' })
  @ApiConflictResponse({
    description: 'The hotel photos changed while this upload was processing.',
  })
  @ApiResponse({ status: 413, description: 'An image is larger than 5 MB.' })
  @ApiResponse({ status: 415, description: 'An image is not a JPG or PNG.' })
  addPhotos(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
    @UploadedFiles() files: ImageFile[] | undefined,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.addPhotos(id, userId, files);
  }

  @Delete(':id/photos/:filename')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Remove a hotel photo',
    description:
      'HTL-01: A hotel moderator removes a photo from their assigned hotel.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiParam({
    name: 'filename',
    description: 'Stored photo filename',
    example: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
  })
  @ApiOkResponse({
    description: 'The hotel photo was removed',
    type: HotelResponseDto,
  })
  @ApiBadRequestResponse({ description: 'The hotel id is malformed.' })
  @ApiUnauthorizedResponse({ description: 'You must log in to do this.' })
  @ApiForbiddenResponse({
    description: 'The moderator is not assigned to this hotel.',
  })
  @ApiNotFoundResponse({
    description: 'The hotel or its photo does not exist.',
  })
  removePhoto(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('filename') filename: string,
    @CurrentUser('id') userId: string,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.removePhoto(id, userId, filename);
  }
}
