import { PartialType } from '@nestjs/swagger';
import { CreateTransportCostDto } from './create-transport-cost.dto';

/**
 * ITN-16: edit a transport cost. Send only what changes; a new `dayId` moves
 * it to that day. The service refuses `null` (assertNoNullFields).
 */
export class UpdateTransportCostDto extends PartialType(
  CreateTransportCostDto,
) {}
