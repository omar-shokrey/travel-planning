import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { sortCancellationTiers } from './cancellation-tiers';
import type { HotelPolicyResponseDto } from './dto/hotel-policy-response.dto';
import type { SetHotelPoliciesDto } from './dto/set-hotel-policies.dto';
import { HotelsService } from './hotels.service';
import { toHotelPolicyResponse } from './mappers/hotel-policy.mapper';

/** The policies a hotel moderator sets for their hotel (HTL-09, HTL-10). */
@Injectable()
export class HotelPoliciesService {
  constructor(private readonly hotelsService: HotelsService) {}

  /**
   * HTL-09 and HTL-10: sets the standard check-in and check-out times and the
   * cancellation tiers of the hotel the logged-in moderator is assigned to.
   * The new policies replace the old ones as a whole.
   */
  async set(
    hotelId: string,
    dto: SetHotelPoliciesDto,
    userId: string,
  ): Promise<HotelPolicyResponseDto> {
    // 404 when the hotel does not exist, 403 when it is not the moderator's.
    const hotel = await this.hotelsService.findManagedEntityOrThrow(
      hotelId,
      userId,
    );

    hotel.policy = {
      checkInTime: dto.checkInTime,
      checkOutTime: dto.checkOutTime,
      cancellationTiers: sortCancellationTiers(dto.cancellationTiers).map(
        (tier) => ({
          daysBefore: tier.daysBefore,
          refundPercent: tier.refundPercent,
        }),
      ),
    };
    await hotel.save();

    const response = toHotelPolicyResponse(hotel.policy);
    if (!response) {
      // Cannot happen: the policy was set two statements above.
      throw new InternalServerErrorException();
    }
    return response;
  }
}
