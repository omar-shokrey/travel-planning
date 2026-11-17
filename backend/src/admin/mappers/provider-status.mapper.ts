import type { Types } from 'mongoose';
import type { ProviderType } from '../../common/enums/provider-type.enum';
import type { ProviderStatusResponseDto } from '../dto/provider-status-response.dto';

/** The fields of a stored hotel or airline that the status response needs. */
export interface ProviderStatusEntity {
  _id: Types.ObjectId;
  name: string;
  active: boolean;
}

/** A stored hotel or airline as the answer of the ACC-15 provider routes. */
export function toProviderStatusResponse(
  type: ProviderType,
  provider: ProviderStatusEntity,
): ProviderStatusResponseDto {
  return {
    type,
    id: provider._id.toString(),
    name: provider.name,
    active: provider.active,
  };
}
