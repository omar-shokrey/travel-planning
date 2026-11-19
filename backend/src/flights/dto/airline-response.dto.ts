import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { CancellationTierResponseDto } from './cancellation-tier-response.dto';

/** Public fields returned for an airline profile. */
export class AirlineResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({ example: 'EgyptAir' })
  name: string;

  @ApiProperty({ example: 'MS' })
  code: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-4789-9012-345678abcdef.png' })
  logo: string;

  @ApiProperty({
    example: '/api/uploads/a1b2c3d4-e5f6-4789-9012-345678abcdef.png',
  })
  logoUrl: string;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({
    type: [CancellationTierResponseDto],
    description:
      'The cancellation policy (FLT-09), highest threshold first. A cancellation is refunded by the tier with the highest `daysBefore` that does not exceed the days remaining before departure; if none applies, or the list is empty, the refund is 0%.',
    example: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
    ],
  })
  cancellationTiers: CancellationTierResponseDto[];

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 5000,
    description: `FLT-08: price of one extra bag, per passenger and per bag, in minor units of ${PLATFORM_CURRENCY} (cents). \`null\` until the airline moderator sets the rule. Each extra bag has the same maximum weight as the free bags of the passenger's cabin, the cabin's \`maxBagKg\` (FLT-04).`,
  })
  extraBagPrice: number | null;

  @ApiProperty({
    example: PLATFORM_CURRENCY,
    description: `Currency of \`extraBagPrice\`: always the platform currency, ${PLATFORM_CURRENCY} (PAY-04)`,
  })
  extraBagCurrency: string;

  @ApiProperty({
    type: 'integer',
    example: 2,
    description:
      "FLT-08: the most extra bags one passenger may buy. 0 means no extra bag is sold, also while the airline moderator has not set the rule. Each extra bag has the same maximum weight as the free bags of the passenger's cabin, the cabin's `maxBagKg` (FLT-04).",
  })
  maxExtraBags: number;

  @ApiProperty({
    description: 'When the airline profile was created, in UTC',
    example: '2026-11-05T11:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'When the airline profile was last updated, in UTC',
    example: '2026-11-05T11:00:00.000Z',
  })
  updatedAt: string;
}
