import type { Types } from 'mongoose';
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
    createdAt: airline.createdAt.toISOString(),
    updatedAt: airline.updatedAt.toISOString(),
  };
}
