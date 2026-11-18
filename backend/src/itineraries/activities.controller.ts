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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UploadImages } from '../uploads/decorators/upload-images.decorator';
import type { ImageFile } from '../uploads/uploads.types';
import { ActivitiesService } from './activities.service';
import { ActivityImagesService } from './activity-images.service';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

/**
 * ITN-10: an activity is edited and deleted by its own id. Adding one is under
 * its day. ITN-12: its images are added and removed here too.
 */
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
  constructor(
    private readonly activities: ActivitiesService,
    private readonly activityImages: ActivityImagesService,
  ) {}

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

  @Post(':id/images')
  @HttpCode(HttpStatus.OK)
  @UploadImages()
  @ApiOperation({
    summary: 'Add images to an activity',
    description:
      'ITN-12, GEN-08. Add JPG or PNG images (5 MB at most each) to an activity of your own itinerary, in the multipart field `images`. An activity has at most 5 images in all; one bad file stores none of them. Returns the itinerary with its days: each activity lists its `images` with the URL they are served at.',
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiOkResponse({
    type: ItineraryDetailResponseDto,
    description: 'The images were added',
  })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, no image was sent, or the activity would have more than 5 images',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No activity has this id' })
  @ApiPayloadTooLargeResponse({ description: 'An image is larger than 5 MB' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'An image is not a JPG or PNG',
  })
  addImages(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
    @UploadedFiles() files: ImageFile[] | undefined,
  ): Promise<ItineraryDetailResponseDto> {
    return this.activityImages.addImages(id, userId, files);
  }

  @Delete(':id/images/:imageId')
  @ApiOperation({
    summary: 'Remove an image from an activity',
    description:
      "ITN-12. Remove one image from an activity of your own itinerary. `imageId` is the stored file name, the `filename` in the activity's `images`. The file is deleted unless a clone of the itinerary (ITN-21) still shows it. Returns the itinerary with its days.",
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiParam({
    name: 'imageId',
    description: 'The stored file name of the image',
    example: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
  })
  @ApiOkResponse({
    type: ItineraryDetailResponseDto,
    description: 'The image was removed',
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description: 'No activity has this id, or it has no such image',
  })
  removeImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId') imageId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.activityImages.removeImage(id, imageId, userId);
  }
}
