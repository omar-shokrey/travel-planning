import { ApiProperty } from '@nestjs/swagger';
import { FlightBookingStatus } from '../../flight-bookings/enums/flight-booking-status.enum';
import { PassengerType } from '../../flight-bookings/enums/passenger-type.enum';
import { CabinClass } from '../models/cabin-class.enum';
import { FlightResponseDto } from './flight-response.dto';

export class FlightBookingPassengerDto {
  @ApiProperty({ example: 'Sara Ahmed' })
  fullName: string;

  @ApiProperty({ enum: PassengerType, enumName: 'PassengerType' })
  type: PassengerType;
}

/** FLT-29: one booking of the flight, as its airline sees it. */
export class FlightBookingOfFlightDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90aaa' })
  bookingId: string;

  @ApiProperty({ example: 'FB7K2Q9M' })
  reference: string;

  @ApiProperty({
    enum: [
      FlightBookingStatus.Confirmed,
      FlightBookingStatus.Completed,
      FlightBookingStatus.Cancelled,
    ],
    description:
      'confirmed, completed (the flight has arrived, GEN-11) or cancelled',
  })
  status: FlightBookingStatus;

  @ApiProperty({
    enum: CabinClass,
    enumName: 'CabinClass',
    description: 'The cabin on this flight',
  })
  cabin: CabinClass;

  @ApiProperty({
    example: 2,
    description:
      'Seats on this flight: adults and children (infants take none)',
  })
  seats: number;

  @ApiProperty({ type: [FlightBookingPassengerDto] })
  passengers: FlightBookingPassengerDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelledAt: string | null;
}

/**
 * FLT-29: the bookings of one flight for its airline's moderator, with the
 * flight itself, whose `cabins` show the seats remaining in each category
 * (`availableSeats`).
 */
export class FlightBookingsResponseDto {
  @ApiProperty({ type: FlightResponseDto })
  flight: FlightResponseDto;

  @ApiProperty({ type: [FlightBookingOfFlightDto] })
  bookings: FlightBookingOfFlightDto[];

  @ApiProperty({
    example: 3,
    description:
      'Passengers flying: those of the confirmed and completed bookings, infants included',
  })
  passengerCount: number;
}
