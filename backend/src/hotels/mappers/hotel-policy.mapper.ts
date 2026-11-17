import { sortCancellationTiers } from '../cancellation-tiers';
import type { HotelDetailsResponseDto } from '../dto/hotel-details-response.dto';
import type { HotelPolicyResponseDto } from '../dto/hotel-policy-response.dto';
import type { HotelPolicy } from '../models/hotel-policy.schema';
import { toHotelResponse, type HotelSource } from './hotel.mapper';

/** The stored policy. A policy saved before HTL-10 has no tiers yet. */
export type HotelPolicySource = Pick<
  HotelPolicy,
  'checkInTime' | 'checkOutTime'
> &
  Partial<Pick<HotelPolicy, 'cancellationTiers'>>;

/** The hotel's policies, or `null` when the moderator has not set them yet. */
export function toHotelPolicyResponse(
  policy: HotelPolicySource | null | undefined,
): HotelPolicyResponseDto | null {
  if (!policy) {
    return null;
  }

  return {
    checkInTime: policy.checkInTime,
    checkOutTime: policy.checkOutTime,
    cancellationTiers: sortCancellationTiers(
      policy.cancellationTiers ?? [],
    ).map((tier) => ({
      daysBefore: tier.daysBefore,
      refundPercent: tier.refundPercent,
    })),
  };
}

/** The hotel page: the profile of HTL-01 plus the policies. */
export function toHotelDetailsResponse(
  hotel: HotelSource & { policy?: HotelPolicySource | null },
): HotelDetailsResponseDto {
  return {
    ...toHotelResponse(hotel),
    policy: toHotelPolicyResponse(hotel.policy),
  };
}
