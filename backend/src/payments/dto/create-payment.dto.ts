import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../enums/booking-type.enum';

/**
 * The body of `POST /api/payments` (PAY-01). It names the booking and nothing
 * else: the amount, the currency and the owner come from the booking, never
 * from the client.
 */
export class CreatePaymentDto {
  @ApiProperty({
    enum: BookingType,
    enumName: 'BookingType',
    description:
      'The kind of booking to pay: a flight booking or a hotel reservation',
    example: BookingType.Flight,
  })
  @IsEnum(BookingType, { message: 'bookingType must be one of: flight, hotel' })
  bookingType: BookingType;

  @ApiProperty({
    description:
      'Id of the booking to pay. It must be your own, waiting for payment, with a live hold and accepted policies',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  @IsMongoId({ message: 'bookingId must be a valid id' })
  bookingId: string;
}
