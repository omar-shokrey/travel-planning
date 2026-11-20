import { MODULE_METADATA } from '@nestjs/common/constants';
import { HotelBookingCompletionService } from './hotel-booking-completion.service';
import { HotelBookingExpiryService } from './hotel-booking-expiry.service';
import { HotelBookingsModule } from './hotel-bookings.module';

describe('HotelBookingsModule', () => {
  it('runs both lifecycle jobs (GEN-11): the hold expiry and the completion', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, HotelBookingsModule),
    ).toEqual(
      expect.arrayContaining([
        HotelBookingExpiryService,
        HotelBookingCompletionService,
      ]),
    );
  });
});
