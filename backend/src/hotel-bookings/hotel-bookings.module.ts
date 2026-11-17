import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
import { HotelBookingExpiryService } from './hotel-booking-expiry.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelReservationsController } from './hotel-reservations.controller';
import { HotelReservationsService } from './hotel-reservations.service';
import {
  HotelBooking,
  HotelBookingSchema,
} from './models/hotel-booking.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
    HotelsModule,
    // The guest names of HTL-22.
    UsersModule,
  ],
  controllers: [HotelBookingsController, HotelReservationsController],
  providers: [
    HotelBookingsService,
    HotelBookingExpiryService,
    HotelReservationsService,
  ],
})
export class HotelBookingsModule {}
