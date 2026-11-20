import { MODULE_METADATA } from '@nestjs/common/constants';
import { FlightBookingCompletionService } from './flight-booking-completion.service';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import { FlightBookingsModule } from './flight-bookings.module';

describe('FlightBookingsModule', () => {
  it('runs both lifecycle jobs (GEN-11): the hold expiry and the completion', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FlightBookingsModule),
    ).toEqual(
      expect.arrayContaining([
        FlightBookingExpiryService,
        FlightBookingCompletionService,
      ]),
    );
  });
});
