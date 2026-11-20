import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../enums/booking-type.enum';

/**
 * The body of `POST /api/payments` (PAY-01). It names the booking (or the
 * flight change, FLT-27) and nothing else: the amount, the currency and the
 * owner come from the booking or the change, never from the client.
 */
export class CreatePaymentDto {
  @ApiProperty({
    enum: BookingType,
    enumName: 'BookingType',
    description:
      'What to pay: a flight booking, a hotel reservation, or the fare difference of a flight change (FLT-27)',
    example: BookingType.Flight,
  })
  @IsEnum(BookingType, {
    message: 'bookingType must be one of: flight, hotel, flight_change',
  })
  bookingType: BookingType;

  @ApiProperty({
    description:
      'Id of the booking (or, for `flight_change`, of the change) to pay. It must be your own, waiting for payment, with a live hold and accepted policies',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  @IsMongoId({ message: 'bookingId must be a valid id' })
  bookingId: string;
}
