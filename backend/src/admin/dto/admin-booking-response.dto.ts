import { ApiProperty } from '@nestjs/swagger';
import { ProviderType } from '../../common/enums/provider-type.enum';
import {
  BOOKING_KINDS,
  type BookingKind,
  BookingType,
} from '../../payments/enums/booking-type.enum';
import {
  ADMIN_BOOKING_STATUSES,
  type AdminBookingStatus,
} from '../admin-bookings.constants';

/** The account that made the booking. */
export class AdminBookingUserDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({
    description: '"(unknown)" if the account cannot be found any more',
    example: 'Sara Ahmed',
  })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null if the account cannot be found any more',
    example: 'sara@example.com',
  })
  email: string | null;
}

/** An airline or hotel of the booking. */
export class AdminBookingProviderDto {
  @ApiProperty({
    enum: ProviderType,
    enumName: 'ProviderType',
    example: ProviderType.Airline,
  })
  type: ProviderType;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  id: string;

  @ApiProperty({
    description: '"(unknown)" if the airline or hotel cannot be found any more',
    example: 'Nile Air',
  })
  name: string;
}

/** When the trip starts and ends. */
export class AdminBookingDatesDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Flight: the first departure, UTC ISO 8601. Hotel: the check-in day, YYYY-MM-DD. null if a flight of the booking cannot be found.',
    example: '2026-12-01T08:30:00.000Z',
  })
  start: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Flight: the last arrival, UTC ISO 8601. Hotel: the check-out day, YYYY-MM-DD. null if a flight of the booking cannot be found.',
    example: '2026-12-08T14:10:00.000Z',
  })
  end: string | null;
}

/**
 * One row of the admin list of all bookings (ACC-17): a flight booking or a
 * hotel reservation. Read only. It never carries passengers, the fare and
 * baggage breakdown, the policies, the hold or anything about payments.
 */
export class AdminBookingResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90777' })
  id: string;

  @ApiProperty({
    enum: BOOKING_KINDS,
    enumName: 'BookingKind',
    example: BookingType.Flight,
  })
  type: BookingKind;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The booking reference; null until the booking is confirmed',
    example: 'FB7K2QX9',
  })
  reference: string | null;

  @ApiProperty({
    enum: ADMIN_BOOKING_STATUSES,
    example: 'confirmed',
  })
  status: AdminBookingStatus;

  @ApiProperty({ type: AdminBookingUserDto })
  user: AdminBookingUserDto;

  @ApiProperty({
    type: [AdminBookingProviderDto],
    description:
      'Hotel: its one hotel. Flight: the distinct airlines of its flights, in the order of the flights (a round trip can have two).',
  })
  providers: AdminBookingProviderDto[];

  @ApiProperty({ type: AdminBookingDatesDto })
  dates: AdminBookingDatesDto;

  @ApiProperty({
    description: 'What the user pays, in minor units (cents)',
    example: 45000,
  })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    description: 'When the booking was made, UTC ISO 8601',
    example: '2026-11-05T11:00:00.000Z',
  })
  createdAt: string;
}
