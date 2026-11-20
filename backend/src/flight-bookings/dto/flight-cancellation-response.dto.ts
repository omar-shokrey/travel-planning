import { ApiProperty } from '@nestjs/swagger';
import { FlightResponseDto } from '../../flights/dto/flight-response.dto';

/** FLT-06: the cancelled flight and what its cancellation did to the bookings. */
export class FlightCancellationResponseDto {
  @ApiProperty({
    type: FlightResponseDto,
    description: 'The flight, now `cancelled`',
  })
  flight: FlightResponseDto;

  @ApiProperty({
    example: 3,
    description:
      'Confirmed bookings cancelled with a 100% refund and an in-app notification',
  })
  cancelledBookings: number;

  @ApiProperty({
    example: 1,
    description: 'Holds waiting for payment that expired, their seats released',
  })
  expiredHolds: number;
}
