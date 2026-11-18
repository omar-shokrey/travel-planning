import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoomStatus } from '../room-status';

/** Consecutive nights of a room with the same status (HTL-08). */
export class RoomStatusSegmentResponseDto {
  @ApiProperty({ description: 'First night, inclusive', example: '2026-12-04' })
  from: string;

  @ApiProperty({
    description: 'The day after the last night (exclusive)',
    example: '2026-12-07',
  })
  to: string;

  @ApiProperty({
    enum: RoomStatus,
    description:
      '`available`: bookable and free. `booked`: a reservation has the nights. `blocked`: blocked by the moderator (HTL-06). `unavailable`: outside every availability range of the room.',
    example: RoomStatus.Booked,
  })
  status: RoomStatus;

  @ApiPropertyOptional({
    description:
      'Only when booked: the id of the reservation that has the nights.',
    example: '6740f1c2a4b5c6d7e8f90130',
  })
  bookingId?: string;

  @ApiPropertyOptional({
    description:
      'Only when booked: true while the reservation is Pending Payment and its hold has not expired, false when it is Confirmed.',
    example: false,
  })
  pendingPayment?: boolean;
}

/** One room of the hotel with the status of every night of the range. */
export class RoomStatusResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90124' })
  id: string;

  @ApiProperty({ example: '101' })
  number: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({
    description: 'False when the room is deactivated (HTL-06)',
    example: true,
  })
  active: boolean;

  @ApiProperty({
    type: [RoomStatusSegmentResponseDto],
    description:
      'The whole range, in order, with no gap: consecutive nights of the same status and the same reservation are joined.',
  })
  segments: RoomStatusSegmentResponseDto[];
}
