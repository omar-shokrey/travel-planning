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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreateReviewReplyDto } from './dto/create-review-reply.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import {
  REVIEW_EXISTS_MESSAGE,
  REVIEW_NOT_COMPLETED_MESSAGE,
  REPLY_TEXT_MAX_LENGTH,
  REVIEW_NOT_FOUND_MESSAGE,
  REVIEW_REPLY_EXISTS_MESSAGE,
  REVIEW_UPDATE_EMPTY_MESSAGE,
} from './hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';
import { ReviewsService } from './reviews.service';

const RATING_NOTE =
  "The hotel's number of ratings and average rating are recomputed from all its visible reviews.";

/** HTL-23: rate a completed stay. */
@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/review')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Rate and review a completed stay (HTL-23)',
    description: `Registered users only, for their own reservation once it is **completed** (the day after its check-out date, GEN-11). One rating from 1 to 5 and an optional text of at most 1000 characters, **one per reservation** whatever the number of rooms. ${RATING_NOTE}`,
  })
  @ApiCreatedResponse({ type: ReviewResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, `rating` is missing or not a whole number from 1 to 5, `text` is not a text or has more than 1000 characters, or another field was sent',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such reservation, or it belongs to another user`,
  })
  @ApiConflictResponse({
    description: `"${REVIEW_NOT_COMPLETED_MESSAGE}", or "${REVIEW_EXISTS_MESSAGE}"`,
  })
  create(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser('id') userId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviews.create(id, userId, dto);
  }
}

/** HTL-23: edit or delete one's own review. HTL-26: the hotel's reply. */
@ApiTags('reviews')
@ApiCookieAuth()
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Edit my review (HTL-23)',
    description: `The author only. Send a new \`rating\`, a new \`text\`, or both; an empty text removes the text. ${RATING_NOTE}`,
  })
  @ApiOkResponse({ type: ReviewResponseDto })
  @ApiBadRequestResponse({
    description: `The id is not a valid id, "${REVIEW_UPDATE_EMPTY_MESSAGE}" (neither field was sent), a field is not valid (\`null\` included), or another field was sent`,
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${REVIEW_NOT_FOUND_MESSAGE}": no such review, or it was written by another user`,
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReviewDto,
    @CurrentUser('id') userId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviews.update(id, userId, dto);
  }

  @Post(':id/reply')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Reply to a review of my hotel (HTL-26)',
    description: `HTL-26 (optional). The hotel moderator assigned to the review's hotel replies to a visible review: a text of 1 to ${REPLY_TEXT_MAX_LENGTH} characters, outer spaces removed. **One reply per review**; it cannot be edited or deleted. The reply does not change the hotel's rating, and the review's \`updatedAt\` stays the author's last change.`,
  })
  @ApiCreatedResponse({
    type: ReviewResponseDto,
    description: 'The review with its `reply`',
  })
  @ApiBadRequestResponse({
    description: `The id is not a valid id, \`text\` is missing, not a text, empty or spaces only, or has more than ${REPLY_TEXT_MAX_LENGTH} characters, or another field was sent (\`repliedAt\` and \`moderatorId\` included)`,
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description:
      "The account is not a hotel moderator, or the moderator is not assigned to the review's hotel",
  })
  @ApiNotFoundResponse({
    description: `"${REVIEW_NOT_FOUND_MESSAGE}": no such review, or it is hidden`,
  })
  @ApiConflictResponse({
    description: `"${REVIEW_REPLY_EXISTS_MESSAGE}"`,
  })
  reply(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateReviewReplyDto,
    @CurrentUser('id') moderatorId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviews.reply(id, moderatorId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Delete my review (HTL-23)',
    description: `The author only. The reservation can then be reviewed again. ${RATING_NOTE}`,
  })
  @ApiNoContentResponse({ description: 'The review is deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({ description: 'Not a registered user' })
  @ApiNotFoundResponse({
    description: `"${REVIEW_NOT_FOUND_MESSAGE}": no such review, or it was written by another user`,
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.reviews.remove(id, userId);
  }
}
