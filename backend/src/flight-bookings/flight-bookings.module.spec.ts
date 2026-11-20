import { MODULE_METADATA } from '@nestjs/common/constants';
import { FlightsModule } from '../flights/flights.module';
import { RefundsModule } from '../payments/refunds/refunds.module';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingsModule } from './flight-bookings.module';
import { FlightBookingsService } from './flight-bookings.service';

describe('FlightBookingsModule', () => {
  it('provides the cancellation (FLT-26) with the seats and the refunds it needs', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FlightBookingsModule),
    ).toContain(FlightBookingCancellationService);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, FlightBookingsModule),
    ).toEqual(expect.arrayContaining([FlightsModule, RefundsModule]));
  });

  it('exports FlightBookingsService, for the payments module (PAY-02)', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, FlightBookingsModule),
    ).toEqual([FlightBookingsService]);
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
