import { PartialType } from '@nestjs/swagger';
import { CreateBudgetEntryDto } from './create-budget-entry.dto';

/**
 * ITN-14: edit a budget entry. Send only what changes. The service refuses
 * `null` (assertNoNullFields).
 */
export class UpdateBudgetEntryDto extends PartialType(CreateBudgetEntryDto) {}
