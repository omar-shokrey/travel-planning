import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Types } from 'mongoose';
import { BudgetCategory } from '../enums/budget-category.enum';
import { currencyCode, moneyAmount } from './money.validators';

/** ITN-14: one budget line of a day, in its own currency. Embedded in the day. */
@Schema()
export class BudgetEntry {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(BudgetCategory) })
  category: BudgetCategory;

  @Prop({ required: true, ...moneyAmount })
  amount: number;

  @Prop({ ...currencyCode, required: true })
  currency: string;
}

export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);
