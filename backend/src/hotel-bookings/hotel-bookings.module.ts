import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
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
    HotelsModule,
  ],
  controllers: [HotelBookingsController],
  providers: [HotelBookingsService],
  // HotelBookingsService: the owner lookup and the policy acceptance for the
  // payments module (PAY-02). The payments module imports this one, never the
  // other way round.
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
