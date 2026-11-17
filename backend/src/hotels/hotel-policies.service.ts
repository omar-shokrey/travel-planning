import { Injectable } from '@nestjs/common';
import type { HotelPolicyResponseDto } from './dto/hotel-policy-response.dto';
import type { SetHotelPoliciesDto } from './dto/set-hotel-policies.dto';
import { HotelsService } from './hotels.service';

/** The policies a hotel moderator sets for their hotel (HTL-09). */
@Injectable()
export class HotelPoliciesService {
  constructor(private readonly hotelsService: HotelsService) {}

  /**
   * HTL-09: sets the standard check-in and check-out times of the hotel the
   * logged-in moderator is assigned to.
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

    const policy = {
      checkInTime: dto.checkInTime,
      checkOutTime: dto.checkOutTime,
    };
    hotel.policy = policy;
    await hotel.save();

    return policy;
  }
}
