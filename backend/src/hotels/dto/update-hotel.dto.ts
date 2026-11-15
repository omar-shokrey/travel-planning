import { PartialType } from '@nestjs/swagger';
import { CreateHotelDto } from './create-hotel.dto';

/**
 * What the moderator of a hotel may change in its profile (HTL-01). Every
 * field is optional; a field that is left out keeps its value.
 */
export class UpdateHotelDto extends PartialType(CreateHotelDto) {}

/**
 * The fields of an update that were sent as `null`, sorted. `PartialType`
 * makes every field `@IsOptional()`, and that skips validation for `null` as
 * well as for a missing field, so the DTO alone cannot refuse it. Every hotel
 * field is required, so `null` is never a valid value.
 */
export function nullFieldsOf(dto: UpdateHotelDto): string[] {
  return Object.entries(dto)
    .filter(([, value]) => value === null)
    .map(([field]) => field)
    .sort();
}
