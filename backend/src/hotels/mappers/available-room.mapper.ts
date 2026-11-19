import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import type { AvailableRoomResponseDto } from '../dto/available-room-response.dto';
import type { Room } from '../models/room.schema';

export type AvailableRoomSource = Pick<
  Room,
  'number' | 'type' | 'beds' | 'maxOccupancy' | 'pricePerNight'
> & { _id: Types.ObjectId };

/** HTL-15: a free room with the price of a stay of `nights` nights. */
export function toAvailableRoomResponse(
  room: AvailableRoomSource,
  nights: number,
): AvailableRoomResponseDto {
  return {
    id: room._id.toString(),
    number: room.number,
    type: room.type,
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    pricePerNight: room.pricePerNight,
    nights,
    // Whole minor units times whole nights: always a whole number.
    totalPrice: room.pricePerNight * nights,
    currency: PLATFORM_CURRENCY,
  };
}
