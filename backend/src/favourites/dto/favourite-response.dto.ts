import { ApiProperty } from '@nestjs/swagger';
import { FavouriteTargetType } from '../enums/favourite-target-type.enum';

/** BON-02: the public card of a saved hotel. */
export class FavouriteHotelSummaryDto {
  @ApiProperty({ example: 'Cairo Garden Hotel' })
  name: string;

  @ApiProperty({ example: 'EG-CAI' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  starClass: number;

  @ApiProperty({ example: 4.5 })
  averageRating: number;

  @ApiProperty({ example: 12 })
  ratingCount: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The first photo of the hotel, or `null` when it has none',
    example: '/api/uploads/c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
  })
  photoUrl: string | null;
}

/** BON-02: the public card of a saved itinerary, as the public search shows it. */
export class FavouriteItinerarySummaryDto {
  @ApiProperty({ example: 'Ten days in Egypt' })
  title: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  authorName: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries: string[];

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({ example: 10 })
  dayCount: number;
}

/** BON-02: one favourite of the logged-in user. */
export class FavouriteResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0f00d' })
  id: string;

  @ApiProperty({
    enum: FavouriteTargetType,
    enumName: 'FavouriteTargetType',
    example: FavouriteTargetType.Hotel,
  })
  targetType: FavouriteTargetType;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  targetId: string;

  @ApiProperty({
    description: 'When it was saved (UTC)',
    example: '2026-11-20T18:00:00.000Z',
  })
  addedAt: string;

  @ApiProperty({
    description:
      'False when the target can no longer be seen by the public: the hotel was deactivated, the itinerary was made private, hidden or its author deactivated, or it was deleted. The favourite stays so it can be removed; it then has no summary.',
    example: true,
  })
  available: boolean;

  @ApiProperty({
    type: FavouriteHotelSummaryDto,
    nullable: true,
    description: 'The hotel, for an available hotel; otherwise `null`',
  })
  hotel: FavouriteHotelSummaryDto | null;

  @ApiProperty({
    type: FavouriteItinerarySummaryDto,
    nullable: true,
    description: 'The itinerary, for an available itinerary; otherwise `null`',
  })
  itinerary: FavouriteItinerarySummaryDto | null;
}
