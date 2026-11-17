import type { Types } from 'mongoose';
import type { RoomStatusResponseDto } from '../dto/room-status-response.dto';
import type { Room } from '../models/room.schema';
import type { RoomStatusSegment } from '../room-status';

export type RoomStatusSource = Pick<Room, 'number' | 'type' | 'active'> & {
  _id: Types.ObjectId;
};

/** HTL-08: a room and the status segments of the requested range. */
export function toRoomStatusResponse(
  room: RoomStatusSource,
  segments: readonly RoomStatusSegment[],
): RoomStatusResponseDto {
  return {
    id: room._id.toString(),
    number: room.number,
    type: room.type,
    active: room.active,
    segments: segments.map(
      ({ from, to, status, bookingId, pendingPayment }) => ({
        from,
        to,
        status,
        ...(bookingId !== undefined && { bookingId }),
        ...(pendingPayment !== undefined && { pendingPayment }),
      }),
    ),
  };
}
