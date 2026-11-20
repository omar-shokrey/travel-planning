import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import {
  BOOKING_KINDS,
  type BookingKind,
  BookingType,
} from '../enums/booking-type.enum';

/**
 * The path of `/api/bookings/:type/:id/...` (PAY-02), validated like a body.
 * Only a real booking has policies: `flight_change` (FLT-27) is 400.
 */
export class BookingPathDto {
  @ApiProperty({
    enum: BOOKING_KINDS,
    enumName: 'BookingKind',
    description: 'The kind of booking: a flight booking or a hotel reservation',
    example: BookingType.Flight,
  })
  @IsIn(BOOKING_KINDS, { message: 'type must be one of: flight, hotel' })
  type: BookingKind;

  @ApiProperty({
    description: 'Id of the booking',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;
}
