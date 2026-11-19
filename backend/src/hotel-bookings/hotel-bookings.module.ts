import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
import { HotelBookingExpiryService } from './hotel-booking-expiry.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HotelBooking,
  HotelBookingSchema,
} from './models/hotel-booking.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
    // HotelRoomHoldsService: the hotels module owns the rooms' nights.
    HotelsModule,
  ],
  controllers: [HotelBookingsController],
  // HotelBookingExpiryService: the hold-expiry job (HTL-18).
  providers: [HotelBookingsService, HotelBookingExpiryService],
  // HotelBookingsService: the owner lookup and the policy acceptance for the
  // payments module (PAY-02). The payments module imports this one, never the
  // other way round.
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
