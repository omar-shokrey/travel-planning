import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../enums/booking-type.enum';

/** The path of `/api/bookings/:type/:id/...` (PAY-02), validated like a body. */
export class BookingPathDto {
  @ApiProperty({
    enum: BookingType,
    enumName: 'BookingType',
    description: 'The kind of booking: a flight booking or a hotel reservation',
    example: BookingType.Flight,
  })
  @IsEnum(BookingType, { message: 'type must be one of: flight, hotel' })
  type: BookingType;

  @ApiProperty({
    description: 'Id of the booking',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;
}
