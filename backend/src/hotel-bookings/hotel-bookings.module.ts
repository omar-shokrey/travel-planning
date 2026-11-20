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
    // HTL-17: the in-app notification of a confirmed reservation (GEN-01). It
    // imports nothing of the booking modules, so there is no cycle.
    NotificationsModule,
    // HTL-21: the refund of a cancelled reservation (PAY-03). RefundsModule
    // imports no booking module, so there is no cycle.
    RefundsModule,
  ],
  controllers: [
    HotelBookingsController,
    // HTL-21: cancel a hotel reservation.
    HotelBookingCancellationController,
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
  ],
  // HotelBookingsService: the owner lookup and the policy acceptance for the
  // payments module (PAY-02). The payments module imports this one, never the
  // other way round.
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
