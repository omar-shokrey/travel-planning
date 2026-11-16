import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
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
  | 'availability'
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
    currency: PLATFORM_CURRENCY,
    active: room.active,
    availability: room.availability.map(({ from, to }) => ({ from, to })),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}
