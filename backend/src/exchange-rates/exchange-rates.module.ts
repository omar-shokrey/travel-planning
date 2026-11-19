import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxRatesClient } from './fx-rates.client';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './models/exchange-rate.schema';

/**
 * ITN-18: daily exchange rates from FXRatesAPI, cached in the database. It
 * has no route of its own: the itineraries module converts the budget
 * summary with `ExchangeRatesService` and the functions in `conversion.ts`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  providers: [ExchangeRatesService, FxRatesClient],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
