import type { Types } from 'mongoose';
import { imageUrl } from '../../uploads/uploads.constants';
import type { HotelResponseDto } from '../dto/hotel-response.dto';
import type { Hotel } from '../models/hotel.schema';

export type HotelSource = Pick<
  Hotel,
  | 'name'
  | 'addressLine'
  | 'cityId'
  | 'countryCode'
  | 'description'
  | 'photos'
  | 'starClass'
  | 'amenities'
  | 'active'
  | 'ratingCount'
  | 'averageRating'
  | 'createdAt'
  | 'updatedAt'
> & { _id: Types.ObjectId };

export function toHotelResponse(hotel: HotelSource): HotelResponseDto {
  return {
    id: hotel._id.toString(),
    name: hotel.name,
    addressLine: hotel.addressLine,
    cityId: hotel.cityId,
    countryCode: hotel.countryCode,
    description: hotel.description,
    photos: hotel.photos.map((filename) => ({
      filename,
      url: imageUrl(filename),
    })),
    starClass: hotel.starClass,
    amenities: hotel.amenities,
    active: hotel.active,
    ratingCount: hotel.ratingCount,
    averageRating: hotel.averageRating,
    createdAt: hotel.createdAt.toISOString(),
    updatedAt: hotel.updatedAt.toISOString(),
  };
}
