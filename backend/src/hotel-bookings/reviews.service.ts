import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { HotelsService } from '../hotels/hotels.service';
import type { CreateReviewDto } from './dto/create-review.dto';
import type { ReviewResponseDto } from './dto/review-response.dto';
import type { UpdateReviewDto } from './dto/update-review.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { ReviewModeration } from './enums/review-moderation.enum';
import {
  RATING_RECOMPUTE_ATTEMPTS,
  REVIEW_EXISTS_MESSAGE,
  REVIEW_NOT_COMPLETED_MESSAGE,
  REVIEW_NOT_FOUND_MESSAGE,
  REVIEW_UPDATE_EMPTY_MESSAGE,
} from './hotel-bookings.constants';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';
import { toReviewResponse } from './mappers/review.mapper';
import { HotelBooking } from './models/hotel-booking.schema';
import { Review } from './models/review.schema';

const MONGO_DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === MONGO_DUPLICATE_KEY;

/** The hotel's rating, as `HotelsService.setRating` stores it. */
export interface HotelRating {
  ratingCount: number;
  averageRating: number;
}

/**
 * HTL-23: a registered user rates a completed stay (1 to 5, with an optional
 * text of at most 1000 characters), once per reservation whatever the number
 * of rooms, and later edits or deletes it. The hotel's `ratingCount` and
 * `averageRating` are recomputed after every change from all the visible
 * reviews of the hotel, never added to, so a race cannot make them drift;
 * a failed store is corrected by the next change to that hotel's reviews.
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    private readonly hotels: HotelsService,
  ) {}

  /**
   * POST /api/hotel-bookings/:id/review. 404 for a reservation that does not
   * exist or is someone else's (ACC-11); 409 when it is not completed or
   * already has a review. The unique `bookingId` index decides two reviews
   * at the same moment.
   */
  async create(
    bookingId: string,
    userId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId: new Types.ObjectId(userId) })
      .select('hotelId status')
      .lean()
      .exec();
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    if (booking.status !== HotelBookingStatus.Completed) {
      throw new ConflictException(REVIEW_NOT_COMPLETED_MESSAGE);
    }
    if (await this.reviews.exists({ bookingId: booking._id }).exec()) {
      throw new ConflictException(REVIEW_EXISTS_MESSAGE);
    }

    let review;
    try {
      review = await this.reviews.create({
        hotelId: booking.hotelId,
        userId: new Types.ObjectId(userId),
        bookingId: booking._id,
        rating: dto.rating,
        // An empty text means no text.
        ...(dto.text ? { text: dto.text } : {}),
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(REVIEW_EXISTS_MESSAGE);
      }
      throw error;
    }
    await this.refreshRating(booking.hotelId);
    return toReviewResponse(review.toObject());
  }

  /**
   * PATCH /api/reviews/:id: the author changes the rating, the text, or both;
   * an empty text removes it. Another user's review is the same 404 as one
   * that does not exist.
   */
  async update(
    id: string,
    userId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewResponseDto> {
    if (dto.rating === undefined && dto.text === undefined) {
      throw new BadRequestException(REVIEW_UPDATE_EMPTY_MESSAGE);
    }
    const set: Partial<Pick<Review, 'rating' | 'text'>> = {};
    if (dto.rating !== undefined) set.rating = dto.rating;
    if (dto.text) set.text = dto.text;
    const removeText = dto.text === '';

    const updated = await this.reviews
      .findOneAndUpdate(
        { _id: id, userId: new Types.ObjectId(userId) },
        {
          ...(Object.keys(set).length > 0 ? { $set: set } : {}),
          ...(removeText ? { $unset: { text: '' } } : {}),
        },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException(REVIEW_NOT_FOUND_MESSAGE);
    }
    await this.refreshRating(updated.hotelId);
    return toReviewResponse(updated);
  }

  /**
   * DELETE /api/reviews/:id: the author deletes the review. The reservation
   * can then be reviewed again. Another user's review is a 404.
   */
  async remove(id: string, userId: string): Promise<void> {
    const deleted = await this.reviews
      .findOneAndDelete({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!deleted) {
      throw new NotFoundException(REVIEW_NOT_FOUND_MESSAGE);
    }
    await this.refreshRating(deleted.hotelId);
  }

  /** The count and the average of the hotel's visible reviews, read in one aggregation. */
  async ratingOf(hotelId: Types.ObjectId): Promise<HotelRating> {
    const [stats] = await this.reviews
      .aggregate<{ count: number; average: number }>([
        { $match: { hotelId, moderation: ReviewModeration.Visible } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            average: { $avg: '$rating' },
          },
        },
      ])
      .exec();
    return stats
      ? {
          ratingCount: stats.count,
          // Two decimals: the average of whole ratings, without float noise.
          averageRating: Math.round(stats.average * 100) / 100,
        }
      : { ratingCount: 0, averageRating: 0 };
  }

  /**
   * Recomputes the hotel's rating from scratch and stores it. Two changes at
   * the same moment could each store what they read before the other's
   * write; so after storing, the rating is read again and stored again if it
   * moved, up to RATING_RECOMPUTE_ATTEMPTS times. The last writer always
   * stores what every change left. A failure is logged and does not undo the
   * review: the rating stays as it was until the next change to that hotel's
   * reviews, which recomputes it from scratch.
   */
  private async refreshRating(hotelId: Types.ObjectId): Promise<void> {
    try {
      let rating = await this.ratingOf(hotelId);
      for (
        let attempt = 1;
        attempt <= RATING_RECOMPUTE_ATTEMPTS;
        attempt += 1
      ) {
        await this.hotels.setRating(hotelId, rating);
        const again = await this.ratingOf(hotelId);
        if (
          again.ratingCount === rating.ratingCount &&
          again.averageRating === rating.averageRating
        ) {
          return;
        }
        rating = again;
      }
      // Still moving: store the newest value read, so the last writer never
      // leaves an older one behind.
      await this.hotels.setRating(hotelId, rating);
      this.logger.warn(
        `The rating of hotel ${hotelId.toString()} kept changing while it was stored; the next review change stores it again`,
      );
    } catch (error) {
      this.logger.error(
        `The rating of hotel ${hotelId.toString()} was not recomputed`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
