import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProviderType } from '../common/enums/provider-type.enum';
import { Types, type Model } from 'mongoose';
import { City } from '../reference/models/city.schema';
import { UploadsService } from '../uploads/uploads.service';
import { UsersService } from '../users/users.service';
import type { CreateHotelDto } from './dto/create-hotel.dto';
import type { CreateRoomAvailabilityDto } from './dto/create-room-availability.dto';
import type { CreateRoomDto } from './dto/create-room.dto';
import { HotelsService } from './hotels.service';
import { Hotel, type HotelDocument } from './models/hotel.schema';
import { Room, type RoomDocument } from './models/room.schema';
import type { UpdateHotelDto } from './dto/update-hotel.dto';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const USER_ID = '6740f1c2a4b5c6d7e8f90124';
const ROOM_ID = '6740f1c2a4b5c6d7e8f90125';

function makeHotel(overrides: Partial<Hotel> = {}): HotelDocument {
  const hotel = {
    _id: new Types.ObjectId(HOTEL_ID),
    name: 'Cairo Garden Hotel',
    addressLine: '12 Nile Street',
    cityId: 'city_001',
    countryCode: 'EG',
    description: 'A quiet hotel close to the city centre.',
    photos: [],
    starClass: 4,
    amenities: ['wifi', 'pool'],
    active: true,
    ratingCount: 0,
    averageRating: 0,
    createdAt: new Date('2026-11-05T11:00:00.000Z'),
    updatedAt: new Date('2026-11-05T11:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return hotel as unknown as HotelDocument;
}

function makeRoom(overrides: Partial<Room> = {}): RoomDocument {
  const room = {
    _id: new Types.ObjectId(ROOM_ID),
    hotelId: new Types.ObjectId(HOTEL_ID),
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 12500,
    active: true,
    availability: [],
    createdAt: new Date('2026-11-05T11:00:00.000Z'),
    updatedAt: new Date('2026-11-05T11:00:00.000Z'),
    ...overrides,
  };
  return room as RoomDocument;
}

function moderator(providerType = ProviderType.Hotel, providerId = HOTEL_ID) {
  return {
    assignment: {
      providerType,
      providerId: new Types.ObjectId(providerId),
    },
  };
}

function setup(
  options: {
    hotel?: HotelDocument | null;
    room?: RoomDocument | null;
    updatedRoom?: RoomDocument | null;
    user?: object | null;
    city?: { countryCode: string } | null;
    updatedHotel?: HotelDocument | null;
  } = {},
) {
  const hotel = options.hotel === undefined ? makeHotel() : options.hotel;
  const user =
    'user' in options
      ? options.user
      : hotel
        ? moderator(ProviderType.Hotel, hotel._id.toString())
        : null;
  const city =
    options.city === undefined ? { countryCode: 'EG' } : options.city;
  const updatedHotel =
    options.updatedHotel === undefined ? hotel : options.updatedHotel;
  const room = options.room ?? makeRoom();
  const roomFound = options.room === undefined ? room : options.room;
  const updatedRoom =
    options.updatedRoom === undefined ? room : options.updatedRoom;
  const cityExec = jest.fn().mockResolvedValue(city);
  const hotelExec = jest.fn().mockResolvedValue(hotel);
  const updateExec = jest.fn().mockResolvedValue(updatedHotel);
  const roomExec = jest.fn().mockResolvedValue(roomFound);
  const roomUpdateExec = jest.fn().mockResolvedValue(updatedRoom);
  const hotelsModel = {
    create: jest.fn().mockResolvedValue(hotel),
    findById: jest.fn(() => ({ exec: hotelExec })),
    findOneAndUpdate: jest.fn(() => ({ exec: updateExec })),
  };
  const roomsModel = {
    create: jest.fn().mockResolvedValue(room),
    findOne: jest.fn(() => ({ exec: roomExec })),
    findOneAndUpdate: jest.fn(() => ({ exec: roomUpdateExec })),
  };
  const citiesModel = {
    findById: jest.fn(() => ({ select: jest.fn(() => ({ exec: cityExec })) })),
  };
  const usersService = {
    findEntityById: jest.fn().mockResolvedValue(user),
  };
  const uploads = {
    assertWithinLimit: jest.fn(
      (_owner: string, existing: number, incoming: number) => {
        if (existing + incoming > 5) {
          throw new BadRequestException('A hotel can have at most 5 images.');
        }
      },
    ),
    saveImages: jest
      .fn()
      .mockResolvedValue([
        { filename: 'new-photo.png', url: '/api/uploads/new-photo.png' },
      ]),
    deleteImage: jest.fn().mockResolvedValue(undefined),
  };
  const service = new HotelsService(
    hotelsModel as unknown as Model<Hotel>,
    roomsModel as unknown as Model<Room>,
    citiesModel as unknown as Model<City>,
    usersService as unknown as UsersService,
    uploads as unknown as UploadsService,
  );
  return {
    cityExec,
    citiesModel,
    hotel,
    hotelExec,
    hotelsModel,
    room,
    roomExec,
    roomUpdateExec,
    roomsModel,
    service,
    updateExec,
    updatedHotel,
    uploads,
    usersService,
  };
}

const createDto: CreateHotelDto = {
  name: 'Cairo Garden Hotel',
  addressLine: '12 Nile Street',
  cityId: 'city_001',
  description: 'A quiet hotel close to the city centre.',
  starClass: 4,
  amenities: ['wifi', 'pool'],
};

const createRoomDto: CreateRoomDto = {
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
};

const createRoomAvailabilityDto: CreateRoomAvailabilityDto = {
  from: '2026-12-01',
  to: '2026-12-08',
};

describe('HotelsService (HTL-01)', () => {
  describe('setActive (ACC-15)', () => {
    it.each([false, true])(
      'sets active to %s only when it is not already, in one update',
      async (active) => {
        const updated = makeHotel({ active });
        const { hotelsModel, service } = setup({ updatedHotel: updated });

        expect(await service.setActive(HOTEL_ID, active)).toBe(updated);
        expect(hotelsModel.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: HOTEL_ID, active: { $ne: active } },
          { $set: { active } },
          { returnDocument: 'after' },
        );
      },
    );

    it('returns null when the hotel is missing or already in that state', async () => {
      const { service } = setup({ updatedHotel: null });

      expect(await service.setActive(HOTEL_ID, false)).toBeNull();
    });
  });

  describe('create', () => {
    it('copies the reference city country and sets server-owned defaults', async () => {
      const { hotelsModel, service } = setup({
        city: { countryCode: 'EG' },
      });

      const result = await service.create(createDto);

      expect(hotelsModel.create).toHaveBeenCalledWith({
        ...createDto,
        countryCode: 'EG',
        photos: [],
        active: true,
        ratingCount: 0,
        averageRating: 0,
      });
      expect(result.countryCode).toBe('EG');
      expect(result.photos).toEqual([]);
    });

    it('rejects a city that is not in the reference data', async () => {
      const { hotelsModel, service } = setup({ city: null });

      await expect(service.create(createDto)).rejects.toThrow(
        new BadRequestException('City not found'),
      );
      expect(hotelsModel.create).not.toHaveBeenCalled();
    });
  });

  describe('createRoom (HTL-03)', () => {
    it('stores the room under the hotel and sets its active state', async () => {
      const hotel = makeHotel();
      const { room, roomsModel, service } = setup({ hotel });

      const response = await service.createRoom(
        HOTEL_ID,
        createRoomDto,
        USER_ID,
      );

      expect(roomsModel.create).toHaveBeenCalledWith({
        ...createRoomDto,
        hotelId: hotel._id,
        active: true,
      });
      expect(response).toMatchObject({
        id: room._id.toString(),
        hotelId: HOTEL_ID,
        number: '101',
        active: true,
      });
    });

    describe('addRoomAvailability (HTL-04)', () => {
      it('adds a non-overlapping date range with an atomic conditional update', async () => {
        const room = makeRoom();
        const updatedRoom = makeRoom({
          availability: [createRoomAvailabilityDto],
        });
        const { hotel, roomsModel, service } = setup({
          room,
          updatedRoom,
        });

        const response = await service.addRoomAvailability(
          HOTEL_ID,
          ROOM_ID,
          createRoomAvailabilityDto,
          USER_ID,
        );

        expect(roomsModel.findOne).toHaveBeenCalledWith({
          _id: ROOM_ID,
          hotelId: hotel?._id,
        });
        expect(roomsModel.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: room._id,
            hotelId: hotel?._id,
            availability: {
              $not: {
                $elemMatch: {
                  from: { $lt: createRoomAvailabilityDto.to },
                  to: { $gt: createRoomAvailabilityDto.from },
                },
              },
            },
          },
          {
            $push: {
              availability: {
                $each: [createRoomAvailabilityDto],
                $sort: { from: 1 },
              },
            },
          },
          { returnDocument: 'after', runValidators: true },
        );
        expect(response.availability).toEqual([createRoomAvailabilityDto]);
      });

      it('keeps ranges sorted when adding an earlier range after a later one', async () => {
        const earlier = { from: '2026-12-01', to: '2026-12-08' };
        const later = { from: '2026-12-15', to: '2026-12-20' };
        const room = makeRoom({ availability: [later] });
        const updatedRoom = makeRoom({ availability: [earlier, later] });
        const { roomsModel, service } = setup({ room, updatedRoom });

        const response = await service.addRoomAvailability(
          HOTEL_ID,
          ROOM_ID,
          earlier,
          USER_ID,
        );

        expect(roomsModel.findOneAndUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            availability: {
              $not: {
                $elemMatch: {
                  from: { $lt: earlier.to },
                  to: { $gt: earlier.from },
                },
              },
            },
          }),
          {
            $push: {
              availability: {
                $each: [earlier],
                $sort: { from: 1 },
              },
            },
          },
          { returnDocument: 'after', runValidators: true },
        );
        expect(response.availability).toEqual([earlier, later]);
      });

      it('returns 404 when the hotel does not exist', async () => {
        const { roomsModel, service, usersService } = setup({ hotel: null });

        await expect(
          service.addRoomAvailability(
            HOTEL_ID,
            ROOM_ID,
            createRoomAvailabilityDto,
            USER_ID,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(usersService.findEntityById).not.toHaveBeenCalled();
        expect(roomsModel.findOne).not.toHaveBeenCalled();
      });

      it('checks hotel assignment before loading the room', async () => {
        const user = moderator(ProviderType.Airline, HOTEL_ID);
        const { roomsModel, service } = setup({ user });

        await expect(
          service.addRoomAvailability(
            HOTEL_ID,
            ROOM_ID,
            createRoomAvailabilityDto,
            USER_ID,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(roomsModel.findOne).not.toHaveBeenCalled();
      });

      it('returns 404 when the room does not belong to the hotel', async () => {
        const { roomsModel, service } = setup({ room: null });

        await expect(
          service.addRoomAvailability(
            HOTEL_ID,
            ROOM_ID,
            createRoomAvailabilityDto,
            USER_ID,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(roomsModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('returns 409 when an overlapping range already exists', async () => {
        const { roomsModel, service } = setup({ updatedRoom: null });

        await expect(
          service.addRoomAvailability(
            HOTEL_ID,
            ROOM_ID,
            createRoomAvailabilityDto,
            USER_ID,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(roomsModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      });
    });

    it('returns 404 before checking assignment when the hotel is missing', async () => {
      const { roomsModel, service, usersService } = setup({ hotel: null });

      await expect(
        service.createRoom(HOTEL_ID, createRoomDto, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(usersService.findEntityById).not.toHaveBeenCalled();
      expect(roomsModel.create).not.toHaveBeenCalled();
    });

    it.each([
      [
        'another hotel',
        moderator(ProviderType.Hotel, '6740f1c2a4b5c6d7e8f90126'),
      ],
      ['airline with the same id', moderator(ProviderType.Airline, HOTEL_ID)],
    ])('forbids a moderator assigned to %s', async (_label, user) => {
      const { roomsModel, service } = setup({ user });

      await expect(
        service.createRoom(HOTEL_ID, createRoomDto, USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roomsModel.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('saves profile changes for the moderator assigned to this hotel', async () => {
      const hotel = makeHotel();
      const { service } = setup({ hotel });

      const result = await service.update(
        HOTEL_ID,
        { name: 'Updated name' },
        USER_ID,
      );

      expect(hotel.name).toBe('Updated name');
      expect(hotel.save).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('Updated name');
    });

    it('refreshes the country when the city changes', async () => {
      const hotel = makeHotel();
      const { citiesModel, service } = setup({
        hotel,
        city: { countryCode: 'US' },
      });

      await service.update(HOTEL_ID, { cityId: 'city_002' }, USER_ID);

      expect(citiesModel.findById).toHaveBeenCalledWith('city_002');
      expect(hotel.cityId).toBe('city_002');
      expect(hotel.countryCode).toBe('US');
    });

    it.each([
      ['name'],
      ['addressLine'],
      ['cityId'],
      ['description'],
      ['starClass'],
      ['amenities'],
    ])(
      'refuses %s sent as null with 400, before reading or saving anything',
      async (field) => {
        const hotel = makeHotel();
        const { hotelsModel, service } = setup({ hotel });

        const attempt = service.update(
          HOTEL_ID,
          { [field]: null } as unknown as UpdateHotelDto,
          USER_ID,
        );

        await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
        const error = (await attempt.catch(
          (e: unknown) => e,
        )) as BadRequestException;
        expect(error.getResponse()).toEqual({
          message: 'Validation failed',
          errors: [{ field, messages: [`${field} must not be null`] }],
        });
        expect(hotelsModel.findById).not.toHaveBeenCalled();
        expect(hotel.save).not.toHaveBeenCalled();
      },
    );

    it('lists every field sent as null', async () => {
      const { service } = setup({ hotel: makeHotel() });

      const error = (await service
        .update(
          HOTEL_ID,
          { name: null, amenities: null } as unknown as UpdateHotelDto,
          USER_ID,
        )
        .catch((e: unknown) => e)) as BadRequestException;

      expect(
        (error.getResponse() as { errors: { field: string }[] }).errors.map(
          ({ field }) => field,
        ),
      ).toEqual(['amenities', 'name']);
    });

    it('returns 404 before checking the moderator when the hotel is missing', async () => {
      const { service, usersService } = setup({ hotel: null });

      await expect(
        service.update(HOTEL_ID, { name: 'Updated name' }, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(usersService.findEntityById).not.toHaveBeenCalled();
    });

    it.each([
      ['no assignment', {}],
      [
        'another hotel',
        moderator(ProviderType.Hotel, '6740f1c2a4b5c6d7e8f90125'),
      ],
      ['airline with the same id', moderator(ProviderType.Airline, HOTEL_ID)],
    ])('forbids a moderator with %s', async (_label, user) => {
      const { service } = setup({ user });

      await expect(
        service.update(HOTEL_ID, { name: 'Updated name' }, USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each([undefined, 'not-an-object-id'])(
      'returns 401 for user id %s',
      async (userId) => {
        const { service, usersService } = setup();

        await expect(
          service.update(HOTEL_ID, { name: 'Updated name' }, userId),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(usersService.findEntityById).not.toHaveBeenCalled();
      },
    );

    it('returns 401 when the user id does not resolve to an account', async () => {
      const { service } = setup({ user: null });

      await expect(
        service.update(HOTEL_ID, { name: 'Updated name' }, USER_ID),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown replacement city without saving the profile', async () => {
      const hotel = makeHotel();
      const { service } = setup({ hotel, city: null });

      await expect(
        service.update(HOTEL_ID, { cityId: 'unknown' }, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hotel.save).not.toHaveBeenCalled();
    });
  });

  describe('findEntityOrThrow (for ACC-13)', () => {
    it('returns the stored hotel', async () => {
      const hotel = makeHotel();
      const { hotelsModel, service } = setup({ hotel });

      expect(await service.findEntityOrThrow(HOTEL_ID)).toBe(hotel);
      expect(hotelsModel.findById).toHaveBeenCalledWith(HOTEL_ID);
    });

    it('answers 404 when there is no such hotel', async () => {
      const { service } = setup({ hotel: null });

      await expect(service.findEntityOrThrow(HOTEL_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('addPhotos', () => {
    it('checks the limit before saving and atomically appends filenames', async () => {
      const hotel = makeHotel({ photos: ['existing.jpg'] });
      const updatedHotel = makeHotel({
        photos: ['existing.jpg', 'new-photo.png'],
      });
      const { service, hotelsModel, updateExec, uploads } = setup({
        hotel,
        updatedHotel,
      });

      await service.addPhotos(HOTEL_ID, USER_ID, [
        { originalname: 'new.png', buffer: Buffer.from('image') },
      ]);

      expect(uploads.assertWithinLimit).toHaveBeenCalledWith('hotel', 1, 1);
      expect(
        uploads.assertWithinLimit.mock.invocationCallOrder[0],
      ).toBeLessThan(uploads.saveImages.mock.invocationCallOrder[0]);
      expect(hotelsModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: hotel._id, photos: { $size: 1 } },
        { $push: { photos: { $each: ['new-photo.png'] } } },
        { returnDocument: 'after' },
      );
      expect(updateExec).toHaveBeenCalledTimes(1);
    });

    it('rejects uploads exceeding five photos before storing files', async () => {
      const hotel = makeHotel({ photos: ['1', '2', '3', '4', '5'] });
      const { service, uploads } = setup({ hotel });

      await expect(
        service.addPhotos(HOTEL_ID, USER_ID, [
          { originalname: 'six.png', buffer: Buffer.from('image') },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(uploads.saveImages).not.toHaveBeenCalled();
    });

    it('deletes stored files and returns 409 when the conditional update loses a race', async () => {
      const { service, uploads } = setup({ updatedHotel: null });

      await expect(
        service.addPhotos(HOTEL_ID, USER_ID, [
          { originalname: 'new.png', buffer: Buffer.from('image') },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(uploads.deleteImage).toHaveBeenCalledWith('new-photo.png');
    });
  });

  describe('removePhoto', () => {
    it('removes the filename from the hotel before deleting the file', async () => {
      const hotel = makeHotel({ photos: ['old-photo.jpg'] });
      const updatedHotel = makeHotel({ photos: [] });
      const { service, hotelsModel, updateExec, uploads } = setup({
        hotel,
        updatedHotel,
      });

      await service.removePhoto(HOTEL_ID, USER_ID, 'old-photo.jpg');

      expect(hotelsModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: hotel._id, photos: 'old-photo.jpg' },
        { $pull: { photos: 'old-photo.jpg' } },
        { returnDocument: 'after' },
      );
      expect(updateExec.mock.invocationCallOrder[0]).toBeLessThan(
        uploads.deleteImage.mock.invocationCallOrder[0],
      );
      expect(uploads.deleteImage).toHaveBeenCalledWith('old-photo.jpg');
    });

    it('returns 404 without deleting a file not attached to the hotel', async () => {
      const { service, uploads } = setup({ updatedHotel: null });

      await expect(
        service.removePhoto(HOTEL_ID, USER_ID, 'missing.jpg'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });
  });
});
