import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Types } from 'mongoose';
import { City } from '../../reference/models/city.schema';
import { Activity, ActivitySchema } from './activity.schema';
import { BudgetEntry, BudgetEntrySchema } from './budget-entry.schema';
import { TransportCost, TransportCostSchema } from './transport-cost.schema';

/**
 * ITN-05, ITN-09: one day of an itinerary. Embedded in the itinerary. The day
 * number is the position in the `days` array and the date is the start date
 * plus that position, so neither is stored.
 */
@Schema()
export class ItineraryDay {
  _id: Types.ObjectId;

  /** ITN-09: every day has a city, from the seeded city list. */
  @Prop({ type: String, ref: City.name, required: true })
  cityId: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities: Activity[];

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgetEntries: BudgetEntry[];

  @Prop({ type: [TransportCostSchema], default: [] })
  transportCosts: TransportCost[];
}

export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);
