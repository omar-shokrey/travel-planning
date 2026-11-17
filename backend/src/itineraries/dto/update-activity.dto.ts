import { PartialType } from '@nestjs/swagger';
import { CreateActivityDto } from './create-activity.dto';

/**
 * ITN-10: edit an activity. Send only what changes. The service checks that
 * the activity still has both a cost and a currency, or neither, and refuses
 * `null` (assertNoNullFields).
 */
export class UpdateActivityDto extends PartialType(CreateActivityDto) {}
