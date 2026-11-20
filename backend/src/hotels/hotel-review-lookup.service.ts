import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, Types } from 'mongoose';
import {
  REVIEWS_COLLECTION,
  VISIBLE_REVIEW_MODERATION,
} from './hotels.constants';

/**
 * HTL-24: one review of a hotel as the public list reads it. The fields are
 * those of `REVIEW` in the data model (specs/travel-platform.md). `userId` is
 * read only to find the author's name; it is never returned.
 */
export interface HotelReviewRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  rating: number;
  text?: string;
  /** HTL-26: the hotel's reply, once there is one. Never its moderator id. */
  reply?: { text: string; repliedAt: Date };
  createdAt: Date;
}

/**
 * The fields the list reads: no booking id, moderation, update time or the
 * moderator id of a reply.
 */
const REVIEW_PROJECTION = {
  userId: 1,
  rating: 1,
  text: 1,
  'reply.text': 1,
  'reply.repliedAt': 1,
  createdAt: 1,
} as const;

/**
 * What the hotels module needs to know about reviews. The hotel-bookings
 * module owns them (HTL-23) and imports this module, so this one cannot
 * import it back: it reads the `reviews` collection with the native driver
 * and never writes, as `HotelBookingLookup` does for reservations.
 */
@Injectable()
export class HotelReviewLookup {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * HTL-24: one page of the visible reviews of a hotel, newest first (`_id`
   * breaks ties), with the count of the same filter. The (`hotelId`,
   * `createdAt` descending) index of the `Review` schema narrows it to the
   * hotel; the sort with the `_id` tie-break runs on that hotel's reviews.
   */
  async listVisibleForHotel(
    hotelId: Types.ObjectId,
    page: { skip: number; limit: number },
  ): Promise<{ items: HotelReviewRecord[]; total: number }> {
    const filter = { hotelId, moderation: VISIBLE_REVIEW_MODERATION };
    const collection =
      this.connection.collection<HotelReviewRecord>(REVIEWS_COLLECTION);
    const [items, total] = await Promise.all([
      collection
        .find(filter, { projection: REVIEW_PROJECTION })
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);
    return { items, total };
  }
}
