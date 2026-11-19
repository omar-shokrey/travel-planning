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

/** The policy fields of an airline as every response shows them (FLT-08, FLT-09). */
export type AirlinePolicyFields = Pick<
  AirlineResponseDto,
  'cancellationTiers' | 'extraBagPrice' | 'extraBagCurrency' | 'maxExtraBags'
>;

/**
 * An airline's cancellation tiers (FLT-09) and extra-bag rule (FLT-08), for
 * the airline profile and the flight details (FLT-17). An airline stored
 * before FLT-09 has no policy, and one stored before FLT-08 (or whose
 * moderator has not set the rule) sells no extra bag.
 */
export function toAirlinePolicyFields(
  policy: AirlineSource['policy'] | undefined,
): AirlinePolicyFields {
  return {
    // A new list of plain tiers.
    cancellationTiers: (policy?.cancellationTiers ?? []).map((tier) => ({
      daysBefore: tier.daysBefore,
      refundPercent: tier.refundPercent,
    })),
    // FLT-08, flat next to the tiers.
    extraBagPrice: policy?.extraBagPrice ?? null,
    extraBagCurrency: PLATFORM_CURRENCY,
    maxExtraBags: policy?.maxExtraBags ?? 0,
  };
}

/** Maps an airline to its public API fields. */
export function toAirlineResponse(airline: AirlineSource): AirlineResponseDto {
  return {
    id: airline._id.toString(),
    name: airline.name,
    code: airline.code,
    logo: airline.logo,
    logoUrl: imageUrl(airline.logo),
    active: airline.active,
    ...toAirlinePolicyFields(airline.policy),
    createdAt: airline.createdAt.toISOString(),
    updatedAt: airline.updatedAt.toISOString(),
  };
}
