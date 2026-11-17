import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model, type Types } from 'mongoose';
import { ProviderType } from '../common/enums/provider-type.enum';
import { City } from '../reference/models/city.schema';
import { UploadsService } from '../uploads/uploads.service';
import type { ImageFile } from '../uploads/uploads.types';
import { UsersService } from '../users/users.service';
import type { CreateHotelDto } from './dto/create-hotel.dto';
import type { CreateRoomAvailabilityDto } from './dto/create-room-availability.dto';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { HotelResponseDto } from './dto/hotel-response.dto';
import type { RoomResponseDto } from './dto/room-response.dto';
import { nullFieldsOf, type UpdateHotelDto } from './dto/update-hotel.dto';
import { toHotelResponse } from './mappers/hotel.mapper';
import { toRoomResponse } from './mappers/room.mapper';
import { Hotel, type HotelDocument } from './models/hotel.schema';
import { Room } from './models/room.schema';

const HOTEL_NOT_FOUND_MESSAGE = 'Hotel not found';
const CITY_NOT_FOUND_MESSAGE = 'City not found';
const HOTEL_ACCESS_DENIED_MESSAGE = 'You do not manage this hotel';
const USER_REQUIRED_MESSAGE = 'You must log in to do this';
const HOTEL_PHOTO_CONFLICT_MESSAGE =
  'The hotel photos changed while this upload was processing. Please retry.';
const ROOM_NOT_FOUND_MESSAGE = 'Room not found';
const ROOM_AVAILABILITY_CONFLICT_MESSAGE =
  'The room availability range overlaps an existing range';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    private readonly usersService: UsersService,
    private readonly uploads: UploadsService,
  ) {}

  async create(dto: CreateHotelDto): Promise<HotelResponseDto> {
    const city = await this.cities
      .findById(dto.cityId)
      .select('countryCode')
      .exec();
    if (!city) {
      throw new BadRequestException(CITY_NOT_FOUND_MESSAGE);
    }

    const hotel = await this.hotels.create({
      name: dto.name,
      addressLine: dto.addressLine,
      cityId: dto.cityId,
      countryCode: city.countryCode,
      description: dto.description,
      photos: [],
      starClass: dto.starClass,
      amenities: dto.amenities,
      active: true,
      ratingCount: 0,
      averageRating: 0,
    });
    return toHotelResponse(hotel);
  }

  async createRoom(
    hotelId: string,
    dto: CreateRoomDto,
    userId: string | undefined,
  ): Promise<RoomResponseDto> {
    const hotel = await this.findHotelOrThrow(hotelId);
    await this.assertHotelModerator(hotel, userId);

    const room = await this.rooms.create({
      hotelId: hotel._id,
      number: dto.number,
      type: dto.type,
      beds: dto.beds,
      maxOccupancy: dto.maxOccupancy,
      pricePerNight: dto.pricePerNight,
      active: true,
    });
    return toRoomResponse(room);
  }

  async addRoomAvailability(
    hotelId: string,
    roomId: string,
    dto: CreateRoomAvailabilityDto,
    userId: string | undefined,
  ): Promise<RoomResponseDto> {
    const hotel = await this.findHotelOrThrow(hotelId);
    await this.assertHotelModerator(hotel, userId);

    const room = await this.rooms
      .findOne({ _id: roomId, hotelId: hotel._id })
      .exec();
    if (!room) {
      throw new NotFoundException(ROOM_NOT_FOUND_MESSAGE);
    }

    const updated = await this.rooms
      .findOneAndUpdate(
        {
          _id: room._id,
          hotelId: hotel._id,
          availability: {
            $not: {
              $elemMatch: {
                from: { $lt: dto.to },
                to: { $gt: dto.from },
              },
            },
          },
        },
        {
          $push: {
            availability: {
              $each: [{ from: dto.from, to: dto.to }],
              $sort: { from: 1 },
            },
          },
        },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(ROOM_AVAILABILITY_CONFLICT_MESSAGE);
    }

    return toRoomResponse(updated);
  }

  async update(
    id: string,
    dto: UpdateHotelDto,
    userId: string | undefined,
  ): Promise<HotelResponseDto> {
    // Before anything is read: `null` would reach the schema on save and
    // answer 500, so it is a 400 in the usual validation shape instead.
    const nullFields = nullFieldsOf(dto);
    if (nullFields.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: nullFields.map((field) => ({
          field,
          messages: [`${field} must not be null`],
        })),
      });
    }

    const hotel = await this.findHotelOrThrow(id);
    await this.assertHotelModerator(hotel, userId);

    let updatedCountryCode: string | undefined;
    if (dto.cityId !== undefined && dto.cityId !== hotel.cityId) {
      const city = await this.findCityOrThrow(dto.cityId);
      updatedCountryCode = city.countryCode;
    }

    if (dto.name !== undefined) hotel.name = dto.name;
    if (dto.addressLine !== undefined) hotel.addressLine = dto.addressLine;
    if (dto.cityId !== undefined) hotel.cityId = dto.cityId;
    if (updatedCountryCode !== undefined) {
      hotel.countryCode = updatedCountryCode;
    }
    if (dto.description !== undefined) hotel.description = dto.description;
    if (dto.starClass !== undefined) hotel.starClass = dto.starClass;
    if (dto.amenities !== undefined) hotel.amenities = dto.amenities;

    await hotel.save();
    return toHotelResponse(hotel);
  }

  async addPhotos(
    id: string,
    userId: string | undefined,
    files: readonly ImageFile[] | undefined,
  ): Promise<HotelResponseDto> {
    const hotel = await this.findHotelOrThrow(id);
    await this.assertHotelModerator(hotel, userId);
    this.uploads.assertWithinLimit(
      'hotel',
      hotel.photos.length,
      files?.length ?? 0,
    );

    const storedImages = await this.uploads.saveImages(files);
    try {
      const updated = await this.hotels
        .findOneAndUpdate(
          { _id: hotel._id, photos: { $size: hotel.photos.length } },
          {
            $push: {
              photos: { $each: storedImages.map(({ filename }) => filename) },
            },
          },
          { returnDocument: 'after' },
        )
        .exec();
      if (!updated) {
        throw new ConflictException(HOTEL_PHOTO_CONFLICT_MESSAGE);
      }
      return toHotelResponse(updated);
    } catch (error) {
      await Promise.all(
        storedImages.map(({ filename }) => this.uploads.deleteImage(filename)),
      );
      throw error;
    }
  }

  async removePhoto(
    id: string,
    userId: string | undefined,
    filename: string,
  ): Promise<HotelResponseDto> {
    const hotel = await this.findHotelOrThrow(id);
    await this.assertHotelModerator(hotel, userId);

    const updated = await this.hotels
      .findOneAndUpdate(
        { _id: hotel._id, photos: filename },
        { $pull: { photos: filename } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Hotel photo not found');
    }

    await this.uploads.deleteImage(filename);
    return toHotelResponse(updated);
  }

  /**
   * The hotel entity, for the other services of this module that change a
   * hotel (policies, rooms). Answers 404 when the hotel does not exist and 403
   * when the user is not the moderator assigned to it. Never expose it through
   * a controller.
   */
  async findManagedEntityOrThrow(
    id: string,
    userId: string | undefined,
  ): Promise<HotelDocument> {
    const hotel = await this.findHotelOrThrow(id);
    await this.assertHotelModerator(hotel, userId);
    return hotel;
  }

  private async findHotelOrThrow(id: string): Promise<HotelDocument> {
    const hotel = await this.hotels.findById(id).exec();
    if (!hotel) {
      throw new NotFoundException(HOTEL_NOT_FOUND_MESSAGE);
    }
    return hotel;
  }

  private async findCityOrThrow(cityId: string): Promise<City> {
    const city = await this.cities
      .findById(cityId)
      .select('countryCode')
      .exec();
    if (!city) {
      throw new BadRequestException(CITY_NOT_FOUND_MESSAGE);
    }
    return city;
  }

  private async assertHotelModerator(
    hotel: HotelDocument,
    userId: string | undefined,
  ): Promise<void> {
    if (typeof userId !== 'string' || !isValidObjectId(userId)) {
      throw new UnauthorizedException(USER_REQUIRED_MESSAGE);
    }

    const user = await this.usersService.findEntityById(userId);
    if (!user) {
      throw new UnauthorizedException(USER_REQUIRED_MESSAGE);
    }

    const assignment = user.assignment;
    if (
      assignment?.providerType !== ProviderType.Hotel ||
      assignment.providerId.toString() !== hotel._id.toString()
    ) {
      throw new ForbiddenException(HOTEL_ACCESS_DENIED_MESSAGE);
    }
  }

  /**
   * The stored hotel, for other services (ACC-13 checks that a new moderator's
   * hotel exists). 404 when there is none. Never exposed by a controller.
   */
  findEntityOrThrow(id: string): Promise<HotelDocument> {
    return this.findHotelOrThrow(id);
  }

  /**
   * The names of these hotels by id (as a string), active or not, for the
   * lists of reservations (HTL-20, HTL-22). One query for the whole page.
   * Never exposed by a controller.
   */
  async findNamesByIds(
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const hotels = await this.hotels
      .find({ _id: { $in: ids } })
      .select('name')
      .lean()
      .exec();
    return new Map(hotels.map((hotel) => [hotel._id.toString(), hotel.name]));
  }

  /**
   * Deactivates or reactivates the hotel, for the admin (ACC-15). It changes
   * `active` only when it is not already that value, in one update, so two
   * admins at once cannot both succeed. `null` when the hotel is missing or
   * already in that state. Never exposed by a controller.
   */
  setActive(id: string, active: boolean): Promise<HotelDocument | null> {
    return this.hotels
      .findOneAndUpdate(
        { _id: id, active: { $ne: active } },
        { $set: { active } },
        { returnDocument: 'after' },
      )
      .exec();
  }
}
