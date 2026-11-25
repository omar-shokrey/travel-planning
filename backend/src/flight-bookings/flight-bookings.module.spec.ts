import { MODULE_METADATA } from '@nestjs/common/constants';
import { FlightsModule } from '../flights/flights.module';
import { FLIGHT_CHANGE_PAYMENT_PORT } from '../payments/flight-change-payment-port';
import { RefundsModule } from '../payments/refunds/refunds.module';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingCompletionService } from './flight-booking-completion.service';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import { FlightBookingListService } from './flight-booking-list.service';
import { FlightCancellationController } from './flight-cancellation.controller';
import { FlightCancellationService } from './flight-cancellation.service';
import { FlightBookingsModule } from './flight-bookings.module';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightChangeExpiryService } from './flight-change-expiry.service';
import { FlightChangePaymentService } from './flight-change-payment.service';
import { FlightChangeService } from './flight-change.service';

describe('FlightBookingsModule', () => {
  it('provides the cancellation (FLT-26) with the seats and the refunds it needs', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FlightBookingsModule),
    ).toContain(FlightBookingCancellationService);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, FlightBookingsModule),
    ).toEqual(expect.arrayContaining([FlightsModule, RefundsModule]));
  });

  it('exports FlightBookingsService (PAY-02) and the flight change port (FLT-27), for the payments module', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, FlightBookingsModule),
    ).toEqual([FlightBookingsService, FLIGHT_CHANGE_PAYMENT_PORT]);
  });

  it('provides the flight change port with FlightChangePaymentService (FLT-27)', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FlightBookingsModule),
    ).toEqual(
      expect.arrayContaining([
        FlightChangeService,
        FlightChangeExpiryService,
        FlightChangePaymentService,
        {
          provide: FLIGHT_CHANGE_PAYMENT_PORT,
          useExisting: FlightChangePaymentService,
        },
      ]),
    );
  });

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

  it('provides the user’s lists and details (FLT-25)', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FlightBookingsModule),
    ).toContain(FlightBookingListService);
  });

  it('provides the cancellation by the airline (FLT-06) and its route', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FlightBookingsModule),
    ).toContain(FlightCancellationService);
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, FlightBookingsModule),
    ).toContain(FlightCancellationController);
  });
});
