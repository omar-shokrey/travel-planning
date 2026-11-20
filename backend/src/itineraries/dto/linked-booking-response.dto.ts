import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LinkedBookingType } from '../enums/linked-booking-type.enum';
import { MoneyResponseDto } from './money-response.dto';

/**
 * ITN-27: a booked flight or hotel linked to a day, as the API returns it to
 * the itinerary's owner. The reference, amount and currency are a copy taken
 * when the booking was linked.
 */
export class LinkedBookingResponseDto {
  @ApiProperty({
    description: 'The id of the link (not of the booking)',
    example: '6741c0ffee0ddba11ad0e0e0',
  })
  id: string;

  @ApiProperty({ enum: LinkedBookingType, example: LinkedBookingType.Flight })
  bookingType: LinkedBookingType;

  @ApiProperty({
    description: 'The id of your flight booking or hotel reservation',
    example: '6741c0ffee0ddba11ad0f0f0',
  })
  bookingId: string;

  @ApiProperty({
    description: 'The booking reference, copied when the booking was linked',
    example: 'FB-7KQ2MX',
  })
  reference: string;

  @ApiProperty({
    description:
      "Whole minor units (cents): the booking's total, copied when it was linked. Counts under intercity_transport (flight) or accommodation (hotel).",
    example: 52000,
  })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiPropertyOptional({
    type: MoneyResponseDto,
    nullable: true,
    description:
      'ITN-18. Only when you open your itinerary (GET /api/itineraries/:id): the same amount in your preferred currency (USD when you have none), at the rates in `conversion`. `null` when the currency has no rate.',
    example: { amount: 52000, currency: 'USD' },
  })
  converted?: MoneyResponseDto | null;
}
