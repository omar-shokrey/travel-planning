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
})
export class HotelBookingsModule {}
