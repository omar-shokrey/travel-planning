import { ApiProperty } from '@nestjs/swagger';
import { CancellationTierResponseDto } from '../../hotels/dto/hotel-policy-response.dto';
import { RefundSummaryDto } from '../../payments/refunds/dto/refund-response.dto';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';
import { ReservationGroup } from '../enums/reservation-group.enum';
import { BookedRoomResponseDto } from './hotel-booking-response.dto';

/** The hotel of a reservation (HTL-20). */
export class ReservationHotelDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The hotel name; `null` only if the hotel no longer exists',
    example: 'Nile Hotel',
  })
  name: string | null;
}

/** One room of a reservation in the list (HTL-20). */
export class ReservationRoomDto {
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

/** How many guests the reservation is for, over all its rooms (HTL-20). */
export class ReservationGuestsDto {
  @ApiProperty({ example: 3 })
  adults: number;

  @ApiProperty({ example: 1 })
  children: number;
}

/** HTL-20: one reservation in "My hotel reservations". */
export class HotelReservationListItemDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The booking reference, given when the payment succeeded',
    example: 'HB-7KQ2MX',
  })
  reference: string | null;

  @ApiProperty({ type: ReservationHotelDto })
  hotel: ReservationHotelDto;

  @ApiProperty({ type: [ReservationRoomDto] })
  rooms: ReservationRoomDto[];

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2027-06-15' })
  checkIn: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2027-06-18' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ type: ReservationGuestsDto })
  guests: ReservationGuestsDto;

  @ApiProperty({
    description: 'What was paid, in minor units of `currency`',
    example: 52500,
  })
  total: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    enum: HotelBookingStatus,
    enumName: 'HotelBookingStatus',
    example: HotelBookingStatus.Confirmed,
  })
  status: HotelBookingStatus;

  @ApiProperty({
    enum: ReservationGroup,
    enumName: 'ReservationGroup',
    example: ReservationGroup.Upcoming,
  })
  group: ReservationGroup;
}

/** HTL-20: the full details of one of the user's reservations. */
export class HotelReservationDetailsDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'HB-7KQ2MX' })
  reference: string | null;

  @ApiProperty({ type: ReservationHotelDto })
  hotel: ReservationHotelDto;

  @ApiProperty({
    enum: HotelBookingStatus,
    enumName: 'HotelBookingStatus',
    example: HotelBookingStatus.Confirmed,
  })
  status: HotelBookingStatus;

  @ApiProperty({
    enum: ReservationGroup,
    enumName: 'ReservationGroup',
    nullable: true,
    description:
      'The group of "My hotel reservations"; `null` while it waits for payment or after its hold ran out',
    example: ReservationGroup.Upcoming,
  })
  group: ReservationGroup | null;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2027-06-15' })
  checkIn: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2027-06-18' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The hotel's check-in time when it was booked (HTL-09)",
    example: '14:00',
  })
  checkInTime: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12:00' })
  checkOutTime: string | null;

  @ApiProperty({ type: [BookedRoomResponseDto] })
  rooms: BookedRoomResponseDto[];

  @ApiProperty({ type: ReservationGuestsDto })
  guests: ReservationGuestsDto;

  @ApiProperty({ description: 'Minor units of `currency`', example: 52500 })
  total: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: [CancellationTierResponseDto],
    description:
      'The cancellation tiers copied when it was booked, highest `daysBefore` first (HTL-10)',
  })
  cancellationTiers: CancellationTierResponseDto[];

  @ApiProperty({
    type: RefundSummaryDto,
    nullable: true,
    description:
      'The refund of this reservation and its status (PAY-03), or `null` when there is none',
  })
  refund: RefundSummaryDto | null;

  @ApiProperty({ example: '2027-06-01T10:00:00.000Z' })
  createdAt: string;
}
