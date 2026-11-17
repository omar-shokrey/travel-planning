import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { HotelsService } from '../hotels/hotels.service';
import { todayUtc } from '../hotels/room-dates';
import { User } from '../users/models/user.schema';
import type { CreateReviewDto } from './dto/create-review.dto';
import type { ReviewResponseDto } from './dto/review-response.dto';
import type { UpdateReviewDto } from './dto/update-review.dto';
import { HotelBookingStatus } from './enums/hotel-booking-status.enum';
import { toReviewResponse } from './mappers/review.mapper';
import { HotelBooking } from './models/hotel-booking.schema';
import { Review } from './models/review.schema';

/** MongoDB's error code for a value that breaks a unique index. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

export const RESERVATION_NOT_FOUND_MESSAGE = 'Reservation not found';
export const NOT_YOUR_RESERVATION_MESSAGE =
  'You can only review your own reservations';
export const NOT_COMPLETED_MESSAGE =
  'Only a completed stay can be reviewed: the check-out date must have passed';
export const ALREADY_REVIEWED_MESSAGE =
  'This reservation already has a review. Edit it instead.';
export const REVIEW_NOT_FOUND_MESSAGE = 'Review not found';
export const NOT_YOUR_REVIEW_MESSAGE = 'You can only change your own reviews';
export const EMPTY_UPDATE_MESSAGE = 'Send rating, text or both';

/**
 * HTL-23: a reservation can be reviewed once it is Completed. A Confirmed
 * one whose check-out date has passed counts too, so the guest does not wait
 * for the hourly completion job.
 */
export function isCompletedStay(
  booking: Pick<HotelBooking, 'status' | 'checkOut'>,
  today: string,
): boolean {
  return (
    booking.status === HotelBookingStatus.Completed ||
    (booking.status === HotelBookingStatus.Confirmed &&
      booking.checkOut < today)
  );
}

/** Two decimals, so 4.333… is stored as 4.33. */
export const roundRating = (value: number): number =>
  Math.round(value * 100) / 100;

/** HTL-23: ratings and reviews of completed stays. */
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly hotels: HotelsService,
  ) {}

  /**
   * One rating (1 to 5) and an optional text for the user's own completed
   * reservation, once per reservation whatever its number of rooms. The
   * hotel's average rating is recalculated.
   */
  async create(
    bookingId: string,
    userId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const booking = await this.bookings
      .findById(bookingId)
      .select('userId hotelId status checkOut')
      .lean()
      .exec();
    if (!booking) {
      throw new NotFoundException(RESERVATION_NOT_FOUND_MESSAGE);
    }
    if (booking.userId.toString() !== userId) {
      throw new ForbiddenException(NOT_YOUR_RESERVATION_MESSAGE);
    }
    if (!isCompletedStay(booking, todayUtc())) {
      throw new ConflictException(NOT_COMPLETED_MESSAGE);
    }

    let review;
    try {
      review = await this.reviews.create({
        hotelId: booking.hotelId,
        userId: booking.userId,
        bookingId: booking._id,
        rating: dto.rating,
        ...(dto.text ? { text: dto.text } : {}),
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(ALREADY_REVIEWED_MESSAGE);
      }
      throw error;
    }

    await this.recalculate(booking.hotelId);
    return toReviewResponse(review.toObject(), await this.nameOf(userId));
  }

  /**
   * Edits the user's own review: the rating, the text or both. An empty
   * text removes it. The hotel's average is recalculated when the rating
   * changes.
   */
  async update(
    id: string,
    userId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewResponseDto> {
    if (dto.rating === undefined && dto.text === undefined) {
      throw new BadRequestException(EMPTY_UPDATE_MESSAGE);
    }
    const review = await this.findOwnOrThrow(id, userId);

    const set: Partial<Pick<Review, 'rating' | 'text'>> = {};
    const unset: Record<string, ''> = {};
    if (dto.rating !== undefined) {
      set.rating = dto.rating;
    }
    if (dto.text !== undefined) {
      if (dto.text === '') {
        unset.text = '';
      } else {
        set.text = dto.text;
      }
    }

    const updated = await this.reviews
      .findOneAndUpdate(
        { _id: review._id, userId: review.userId },
        {
          ...(Object.keys(set).length > 0 && { $set: set }),
          ...(Object.keys(unset).length > 0 && { $unset: unset }),
        },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) {
      // Deleted between the read and the update.
      throw new NotFoundException(REVIEW_NOT_FOUND_MESSAGE);
    }

    if (dto.rating !== undefined && dto.rating !== review.rating) {
      await this.recalculate(review.hotelId);
    }
    return toReviewResponse(updated, await this.nameOf(userId));
  }

  /** Deletes the user's own review and recalculates the hotel's average. */
  async remove(id: string, userId: string): Promise<void> {
    const review = await this.findOwnOrThrow(id, userId);
    await this.reviews
      .deleteOne({ _id: review._id, userId: review.userId })
      .exec();
    await this.recalculate(review.hotelId);
  }

  /**
   * Recomputes the hotel's `averageRating` and `ratingCount` from all its
   * reviews, so the summary can never drift from the reviews it sums up.
   */
  async recalculate(hotelId: Types.ObjectId): Promise<void> {
    const [summary] = await this.reviews
      .aggregate<{ count: number; average: number }>([
        { $match: { hotelId } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            average: { $avg: '$rating' },
          },
        },
      ])
      .exec();
    await this.hotels.setRating(
      hotelId,
      summary ? roundRating(summary.average) : 0,
      summary?.count ?? 0,
    );
  }

  /** 404 when the review does not exist, 403 when it is someone else's. */
  private async findOwnOrThrow(
    id: string,
    userId: string,
  ): Promise<
    Pick<Review, 'userId' | 'hotelId' | 'rating'> & {
      _id: Types.ObjectId;
    }
  > {
    const review = await this.reviews
      .findById(id)
      .select('userId hotelId rating')
      .lean()
      .exec();
    if (!review) {
      throw new NotFoundException(REVIEW_NOT_FOUND_MESSAGE);
    }
    if (review.userId.toString() !== userId) {
      throw new ForbiddenException(NOT_YOUR_REVIEW_MESSAGE);
    }
    return review;
  }

  private async nameOf(userId: string): Promise<string | null> {
    const user = await this.users
      .findById(new Types.ObjectId(userId))
      .select('name')
      .lean()
      .exec();
    return user?.name ?? null;
  }
}
