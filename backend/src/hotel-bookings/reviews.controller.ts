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
  ApiConflictResponse,
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
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewsService } from './reviews.service';

const UNAUTHORIZED = {
  description: 'Not logged in, or the access token is invalid or expired',
};

/** HTL-23: the routes of the endpoint table, under two prefixes. */
@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Rate and review a completed stay (HTL-23)',
    description:
      "HTL-23. The guest gives one rating (1 to 5) and an optional text (at most 1000 characters) for their own reservation once it is completed (its check-out date has passed), once per reservation whatever its number of rooms. The hotel's average rating and number of ratings are recalculated.",
  })
  @ApiParam({
    name: 'id',
    description: 'Reservation id',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  @ApiCreatedResponse({ type: ReviewResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, the rating is not a whole number from 1 to 5, the text is longer than 1000 characters, or the body has a field that is not allowed',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    description:
      'The account is not a registered user, or the reservation belongs to someone else',
  })
  @ApiNotFoundResponse({ description: 'The reservation does not exist' })
  @ApiConflictResponse({
    description:
      'The stay is not completed yet (or was cancelled or never paid), or the reservation already has a review',
  })
  create(
    @Param('id', ParseObjectIdPipe) bookingId: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser('id') userId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviews.create(bookingId, userId, dto);
  }

  @Patch('reviews/:id')
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit my review (HTL-23)',
    description:
      "HTL-23. The author changes the rating, the text or both; an empty text removes it. The hotel's average rating is recalculated when the rating changes.",
  })
  @ApiParam({
    name: 'id',
    description: 'Review id',
    example: '6740f1c2a4b5c6d7e8f90999',
  })
  @ApiOkResponse({ type: ReviewResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, nothing was sent, the rating is not a whole number from 1 to 5, or the text is longer than 1000 characters',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    description:
      'The account is not a registered user, or the review belongs to someone else',
  })
  @ApiNotFoundResponse({ description: 'The review does not exist' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReviewDto,
    @CurrentUser('id') userId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviews.update(id, userId, dto);
  }

  @Delete('reviews/:id')
  @Roles(Role.User)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Delete my review (HTL-23)',
    description:
      "HTL-23. The author deletes their review. The hotel's average rating and number of ratings are recalculated, and the reservation can be reviewed again.",
  })
  @ApiParam({
    name: 'id',
    description: 'Review id',
    example: '6740f1c2a4b5c6d7e8f90999',
  })
  @ApiNoContentResponse({ description: 'The review was deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    description:
      'The account is not a registered user, or the review belongs to someone else',
  })
  @ApiNotFoundResponse({ description: 'The review does not exist' })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.reviews.remove(id, userId);
  }
}
