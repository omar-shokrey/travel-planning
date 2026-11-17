import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
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
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
    HotelsModule,
    // The guest names of HTL-22 and the review authors of HTL-23.
    UsersModule,
  ],
  controllers: [
    HotelBookingsController,
    HotelReservationsController,
    ReviewsController,
  ],
  providers: [
    HotelBookingsService,
    HotelBookingExpiryService,
    HotelReservationsService,
    HotelBookingCompletionService,
    ReviewsService,
  ],
})
export class HotelBookingsModule {}
