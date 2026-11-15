import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import { ProviderType } from '../common/enums/provider-type.enum';
import { City } from '../reference/models/city.schema';
import { UploadsService } from '../uploads/uploads.service';
import type { ImageFile } from '../uploads/uploads.types';
import { UsersService } from '../users/users.service';
import type { CreateHotelDto } from './dto/create-hotel.dto';
import type { HotelResponseDto } from './dto/hotel-response.dto';
import type { UpdateHotelDto } from './dto/update-hotel.dto';
import { toHotelResponse } from './mappers/hotel.mapper';
import { Hotel, type HotelDocument } from './models/hotel.schema';

const HOTEL_NOT_FOUND_MESSAGE = 'Hotel not found';
const CITY_NOT_FOUND_MESSAGE = 'City not found';
const HOTEL_ACCESS_DENIED_MESSAGE = 'You do not manage this hotel';
const USER_REQUIRED_MESSAGE = 'You must log in to do this';
const HOTEL_PHOTO_CONFLICT_MESSAGE =
  'The hotel photos changed while this upload was processing. Please retry.';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
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

  async update(
    id: string,
    dto: UpdateHotelDto,
    userId: string | undefined,
  ): Promise<HotelResponseDto> {
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
          { new: true },
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
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Hotel photo not found');
    }

    await this.uploads.deleteImage(filename);
    return toHotelResponse(updated);
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
}
