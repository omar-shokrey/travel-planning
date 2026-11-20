import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { LinkedBookingType } from '../enums/linked-booking-type.enum';

/**
 * ITN-27: link one of your own bookings to a day of your own itinerary. Only
 * the ids and the kind are sent: the reference, the amount and the currency
 * are copied from the booking by the server.
 */
export class LinkBookingDto {
  @ApiProperty({
    description: 'The id of the day to link the booking to',
    example: '6741c0ffee0ddba11ad0d0d0',
  })
  @IsMongoId()
  dayId: string;

  @ApiProperty({
    enum: LinkedBookingType,
    description: 'A flight booking or a hotel reservation',
    example: LinkedBookingType.Flight,
  })
  @IsEnum(LinkedBookingType)
  bookingType: LinkedBookingType;

  @ApiProperty({
    description: 'The id of your flight booking or hotel reservation',
    example: '6741c0ffee0ddba11ad0f0f0',
  })
  @IsMongoId()
  bookingId: string;
}
