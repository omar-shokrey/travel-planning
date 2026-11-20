import { ApiProperty } from '@nestjs/swagger';
import { ModeratorReservationStatus } from '../hotel-booking-lookup.service';

/** HTL-22: the guest who made the reservation, as the moderator sees them. */
export class ModeratorReservationGuestDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The account holder's name; `null` if the account no longer exists",
    example: 'Sara Ahmed',
  })
  name: string | null;
}

/** HTL-22: one room of a reservation. */
export class ModeratorReservationRoomDto {
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

/**
 * HTL-22: one reservation of the moderator's hotel. Only what the moderator
 * needs: the guest's name (no email, phone or account id), the dates, the
 * rooms and the status. No price or payment data.
 */
export class ModeratorReservationResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'HB-7KQ2MX' })
  reference: string | null;

  @ApiProperty({ type: ModeratorReservationGuestDto })
  guest: ModeratorReservationGuestDto;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2027-06-15' })
  checkIn: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2027-06-18' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ type: [ModeratorReservationRoomDto] })
  rooms: ModeratorReservationRoomDto[];

  @ApiProperty({
    enum: ModeratorReservationStatus,
    enumName: 'ModeratorReservationStatus',
    example: ModeratorReservationStatus.Confirmed,
  })
  status: ModeratorReservationStatus;

  @ApiProperty({
    description: 'When the reservation was made, UTC',
    example: '2027-06-01T10:00:00.000Z',
  })
  createdAt: string;
}
