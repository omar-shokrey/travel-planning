import { ApiProperty } from '@nestjs/swagger';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';

/** One room of a reservation, as the hotel moderator sees it (HTL-22). */
export class ReservedRoomResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  roomId: string;

  @ApiProperty({
    description: 'Room number and type when the reservation was made',
    example: '101 (Double)',
  })
  roomLabel: string;

  @ApiProperty({ example: 2 })
  adults: number;

  @ApiProperty({ type: [Number], example: [7] })
  childAges: number[];
}

/** A reservation of the hotel, as its moderator sees it (HTL-22). */
export class HotelReservationResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90789' })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The booking reference, given after payment (HTL-17)',
    example: null,
  })
  reference: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The name of the guest who made the reservation. `null` only if the account no longer exists.',
    example: 'Sara Ahmed',
  })
  guestName: string | null;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2026-12-10' })
  checkIn: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2026-12-13' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({
    enum: HotelBookingStatus,
    enumName: 'HotelBookingStatus',
    example: HotelBookingStatus.Confirmed,
  })
  status: HotelBookingStatus;

  @ApiProperty({ type: [ReservedRoomResponseDto] })
  rooms: ReservedRoomResponseDto[];

  @ApiProperty({ description: 'Minor units', example: 52500 })
  total: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: '2026-11-17T18:00:00.000Z' })
  createdAt: string;
}
