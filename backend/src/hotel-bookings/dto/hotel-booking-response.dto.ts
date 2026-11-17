import { ApiProperty } from '@nestjs/swagger';
import { CancellationTierResponseDto } from '../../hotels/dto/hotel-policy-response.dto';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';

/** One room of a reservation as the API returns it (HTL-16). */
export class BookedRoomResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  roomId: string;

  @ApiProperty({
    description: 'Room number and type when the reservation was made',
    example: '101 (Double)',
  })
  roomLabel: string;

  @ApiProperty({
    description:
      'Price per night in minor units, when the reservation was made',
    example: 12500,
  })
  pricePerNight: number;

  @ApiProperty({
    description: 'Nights x price per night, in minor units',
    example: 37500,
  })
  subtotal: number;

  @ApiProperty({ example: 2 })
  adults: number;

  @ApiProperty({ type: [Number], example: [7] })
  childAges: number[];
}

/** A hotel reservation as the API returns it to its owner (HTL-16, HTL-18). */
export class HotelBookingResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90789' })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The booking reference, given once the payment succeeds (HTL-17). `null` before.',
    example: null,
  })
  reference: string | null;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  hotelId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The name of the hotel now (HTL-20). `null` only if the hotel no longer exists.',
    example: 'Nile View Hotel',
  })
  hotelName: string | null;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2026-12-10' })
  checkIn: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2026-12-13' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({
    enum: HotelBookingStatus,
    enumName: 'HotelBookingStatus',
    description:
      '`pending_payment` while the rooms are held, then `confirmed`, `completed`, `expired` or `cancelled` (GEN-11)',
    example: HotelBookingStatus.PendingPayment,
  })
  status: HotelBookingStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'HTL-18: the rooms are held until this moment (UTC). Pay before it, or the reservation expires and the rooms are released.',
    example: '2026-11-17T18:10:00.000Z',
  })
  holdExpiresAt: string | null;

  @ApiProperty({ description: 'Platform currency (PAY-04)', example: 'USD' })
  currency: string;

  @ApiProperty({
    description: 'Sum of the room subtotals, in minor units',
    example: 52500,
  })
  total: number;

  @ApiProperty({ type: [BookedRoomResponseDto] })
  rooms: BookedRoomResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The hotel's check-in time when the reservation was made (HH:mm, local to the hotel). `null` if the hotel had not set it.",
    example: '14:00',
  })
  checkInTime: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The hotel's check-out time when the reservation was made. `null` if the hotel had not set it.",
    example: '12:00',
  })
  checkOutTime: string | null;

  @ApiProperty({
    type: [CancellationTierResponseDto],
    description:
      "The hotel's cancellation tiers when the reservation was made, highest threshold first",
  })
  cancellationTiers: CancellationTierResponseDto[];

  @ApiProperty({
    description: "PAY-02: when the user accepted the hotel's policies (UTC)",
    example: '2026-11-17T18:00:00.000Z',
  })
  policyAcceptedAt: string;

  @ApiProperty({ example: '2026-11-17T18:00:00.000Z' })
  createdAt: string;
}
