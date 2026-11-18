import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { PostResponseDto } from './dto/post-response.dto';
import { PostImagesService } from './post-images.service';

/**
 * The images of a post (BLG-10, GEN-08). A controller of its own, so the
 * routes of `PostsController` stay as they are.
 */
@ApiTags('Blog')
@ApiCookieAuth()
@Controller('posts')
export class PostImagesController {
  constructor(private readonly postImages: PostImagesService) {}

  @Post(':id/images')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @UploadImages()
  @ApiOperation({
    summary: 'Add images to my post (BLG-10)',
    description:
      'The author only, on a draft or a published post. Send one or more JPG or PNG images (5 MB at most each) in the multipart field `images`. A post has at most 5 images in all. Returns the post: `images` lists the stored file names, each served at `/api/uploads/<name>`.',
  })
  @ApiParam({
    name: 'id',
    description: 'Post id',
    example: '6740f1c2a4b5c6d7e8f90abc',
  })
  @ApiOkResponse({
    description: 'The images were added',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The post id is malformed, no image was sent, or the post would have more than 5 images',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not a registered user, the post belongs to another user, or the account is suspended',
  })
  @ApiNotFoundResponse({ description: 'The post does not exist' })
  @ApiPayloadTooLargeResponse({ description: 'An image is larger than 5 MB' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'An image is not a JPG or PNG',
  })
  addImages(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
    @UploadedFiles() files: ImageFile[] | undefined,
  ): Promise<PostResponseDto> {
    return this.postImages.addImages(id, userId, files);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Remove an image from my post (BLG-10)',
    description:
      'The author only. `imageId` is the stored file name, as listed in the `images` of the post. The image is taken off the post and its file is deleted. Returns the post.',
  })
  @ApiParam({
    name: 'id',
    description: 'Post id',
    example: '6740f1c2a4b5c6d7e8f90abc',
  })
  @ApiParam({
    name: 'imageId',
    description: 'The stored file name of the image',
    example: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
  })
  @ApiOkResponse({
    description: 'The image was removed',
    type: PostResponseDto,
  })
  @ApiBadRequestResponse({ description: 'The post id is malformed' })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not a registered user, the post belongs to another user, or the account is suspended',
  })
  @ApiNotFoundResponse({
    description: 'The post does not exist, or it has no such image',
  })
  removeImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId') imageId: string,
    @CurrentUser('id') userId: string,
  ): Promise<PostResponseDto> {
    return this.postImages.removeImage(id, imageId, userId);
  }
}
