import type { HotelDetailsResponseDto } from '../dto/hotel-details-response.dto';
import type { HotelPolicyResponseDto } from '../dto/hotel-policy-response.dto';
import type { HotelPolicy } from '../models/hotel-policy.schema';
import { toHotelResponse, type HotelSource } from './hotel.mapper';

/** The hotel's policies, or `null` when the moderator has not set them yet. */
export function toHotelPolicyResponse(
  policy: HotelPolicy | null | undefined,
): HotelPolicyResponseDto | null {
  if (!policy) {
    return null;
  }

  return {
    checkInTime: policy.checkInTime,
    checkOutTime: policy.checkOutTime,
  };
}

/** The hotel page: the profile of HTL-01 plus the policies. */
export function toHotelDetailsResponse(
  hotel: HotelSource & { policy?: HotelPolicy | null },
): HotelDetailsResponseDto {
  return {
    ...toHotelResponse(hotel),
    policy: toHotelPolicyResponse(hotel.policy),
  };
}
