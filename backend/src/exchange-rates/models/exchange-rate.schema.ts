import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { EXCHANGE_RATE_BASE } from '../exchange-rates.constants';

/**
 * The exchange rates of one day (ITN-18), the `EXCHANGE_RATE` entity of the
 * data model in `specs/travel-platform.md`. The id is the rate date
 * (`YYYY-MM-DD`), so a second fetch of the same day replaces the rates
 * instead of adding a document.
 */
@Schema({ collection: 'exchange_rates', versionKey: false })
export class ExchangeRate {
  /** The date the rates are for, as the API gives it. */
  @Prop({ type: String, match: /^\d{4}-\d{2}-\d{2}$/ })
  _id: string;

  @Prop({ type: String, required: true, default: EXCHANGE_RATE_BASE })
  base: string;

  /** Currency code to units per one `base`, for example `EGP: 48.6`. */
  @Prop({ type: Map, of: Number, required: true })
  rates: Map<string, number>;

  /** When the rates were fetched. The newest document is the one used. */
  @Prop({ type: Date, required: true })
  fetchedAt: Date;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index({ fetchedAt: -1 });
