import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RefundsModule } from '../payments/refunds/refunds.module';
import { HotelBookingCancellationController } from './hotel-booking-cancellation.controller';
import { HotelBookingCancellationService } from './hotel-booking-cancellation.service';
import { HotelBookingConfirmationService } from './hotel-booking-confirmation.service';
import { HotelBookingCompletionService } from './hotel-booking-completion.service';
import { HotelBookingExpiryService } from './hotel-booking-expiry.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelReservationsController } from './hotel-reservations.controller';
import { HotelReservationsService } from './hotel-reservations.service';
import {
  HotelBooking,
  HotelBookingSchema,
} from './models/hotel-booking.schema';
import { Review, ReviewSchema } from './models/review.schema';
import {
  HotelReviewsController,
  ReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
      // HTL-23: the reviews of completed stays (module table: hotel-bookings).
      { name: Review.name, schema: ReviewSchema },
    ]),
    // HotelRoomHoldsService: the hotels module owns the rooms' nights.
    HotelsModule,
    // HTL-17: the in-app notification of a confirmed reservation (GEN-01). It
    // imports nothing of the booking modules, so there is no cycle.
    NotificationsModule,
    // HTL-21: the refund of a cancelled reservation (PAY-03). RefundsModule
    // imports no booking module, so there is no cycle.
    // HTL-20: the refund shown on the reservation details (PAY-03).
    // RefundsModule imports no booking module, so there is no cycle.
    RefundsModule,
  ],
  controllers: [
    HotelBookingsController,
    // HTL-21: cancel a hotel reservation.
    HotelBookingCancellationController,
    // HTL-20: my hotel reservations.
    HotelReservationsController,
    // HTL-23: rate a completed stay; edit or delete the review.
    HotelReviewsController,
    ReviewsController,
  ],
  // HotelBookingExpiryService: the hold-expiry job (HTL-18).
  // HotelBookingConfirmationService: the confirmation after payment (HTL-17).
  providers: [
    HotelBookingsService,
    HotelBookingExpiryService,
    HotelBookingConfirmationService,
    // GEN-11: the completion job (Confirmed -> Completed).
    HotelBookingCompletionService,
    // HTL-21: cancel a hotel reservation.
    HotelBookingCancellationService,
    // HTL-20: my hotel reservations.
    HotelReservationsService,
    // HTL-23: the reviews and the hotel's rating.
    ReviewsService,
  ],
  // HotelBookingsService: the owner lookup and the policy acceptance for the
  // payments module (PAY-02). The payments module imports this one, never the
  // other way round.
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
