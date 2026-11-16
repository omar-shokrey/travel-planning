import type { Types } from 'mongoose';
import type { RoomResponseDto } from '../dto/room-response.dto';
import type { Room } from '../models/room.schema';

export type RoomSource = Pick<
  Room,
  | 'hotelId'
  | 'number'
  | 'type'
  | 'beds'
  | 'maxOccupancy'
  | 'pricePerNight'
  | 'active'
  | 'createdAt'
  | 'updatedAt'
> & { _id: Types.ObjectId };

export function toRoomResponse(room: RoomSource): RoomResponseDto {
  return {
    id: room._id.toString(),
    hotelId: room.hotelId.toString(),
    number: room.number,
    type: room.type,
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    pricePerNight: room.pricePerNight,
    active: room.active,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}
