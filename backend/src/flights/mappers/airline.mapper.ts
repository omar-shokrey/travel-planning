import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { imageUrl } from '../../uploads/uploads.constants';
import type { AirlineResponseDto } from '../dto/airline-response.dto';
import type { Airline } from '../models/airline.schema';

/** The fields the mapper reads. A document and a lean airline both fit. */
export type AirlineSource = Pick<
  Airline,
  'name' | 'code' | 'logo' | 'active' | 'policy'
> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

/** Maps an airline to its public API fields. */
export function toAirlineResponse(airline: AirlineSource): AirlineResponseDto {
  return {
    id: airline._id.toString(),
    name: airline.name,
    code: airline.code,
    logo: airline.logo,
    logoUrl: imageUrl(airline.logo),
    active: airline.active,
    // A new list of plain tiers: an airline stored before FLT-09 has no policy.
    cancellationTiers: (airline.policy?.cancellationTiers ?? []).map(
      (tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      }),
    ),
    // FLT-08, flat next to the tiers. An airline stored before FLT-08, or
    // one whose moderator has not set the rule, sells no extra bag.
    extraBagPrice: airline.policy?.extraBagPrice ?? null,
    extraBagCurrency: PLATFORM_CURRENCY,
    maxExtraBags: airline.policy?.maxExtraBags ?? 0,
    createdAt: airline.createdAt.toISOString(),
    updatedAt: airline.updatedAt.toISOString(),
  };
}
