import type { ManagedRoomResponseDto } from '../dto/managed-room-response.dto';
import { toRanges } from '../room-dates';
import { toRoomResponse, type RoomSource } from './room.mapper';

/**
 * The room of HTL-03 and HTL-04 plus its blocked nights, joined into date
 * ranges (HTL-06).
 */
export function toManagedRoomResponse(
  room: RoomSource,
  blockedNights: readonly string[],
): ManagedRoomResponseDto {
  return {
    ...toRoomResponse(room),
    blocked: toRanges(blockedNights),
  };
}
