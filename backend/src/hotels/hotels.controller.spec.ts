import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { ImageFile } from '../uploads/uploads.types';
import type { CreateHotelDto } from './dto/create-hotel.dto';
import type { CreateRoomAvailabilityDto } from './dto/create-room-availability.dto';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelsController } from './hotels.controller';
import type { HotelsService } from './hotels.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const ROOM_ID = '6740f1c2a4b5c6d7e8f90124';
const USER_ID = '6740f1c2a4b5c6d7e8f90125';

describe('HotelsController', () => {
  function setup() {
    const hotel = { id: HOTEL_ID, name: 'Cairo Garden Hotel' };
    const room = { id: ROOM_ID, hotelId: HOTEL_ID, number: '101' };
    const service = {
      create: jest.fn().mockResolvedValue(hotel),
      createRoom: jest.fn().mockResolvedValue(room),
      addRoomAvailability: jest.fn().mockResolvedValue(room),
      update: jest.fn().mockResolvedValue(hotel),
      addPhotos: jest.fn().mockResolvedValue(hotel),
      removePhoto: jest.fn().mockResolvedValue(hotel),
    };
    const controller = new HotelsController(
      service as unknown as HotelsService,
    );
    return { controller, service, hotel, room };
  }

  describe('create (HTL-01)', () => {
    it('gives the service the body and returns its answer', async () => {
      const { controller, service, hotel } = setup();
      const body: CreateHotelDto = {
        name: 'Cairo Garden Hotel',
        addressLine: '1 Garden Street',
        cityId: '360630',
        description: 'A quiet hotel by the Nile.',
        starClass: 4,
        amenities: ['wifi', 'pool'],
      };

      expect(await controller.create(body)).toBe(hotel);
      expect(service.create).toHaveBeenCalledWith(body);
    });
  });

  describe('createRoom (HTL-03)', () => {
    it('gives the service the hotel id, the body and the logged-in user, and returns its answer', async () => {
      const { controller, service, room } = setup();
      const body: CreateRoomDto = {
        number: '101',
        type: 'double',
        beds: 2,
        maxOccupancy: 3,
        pricePerNight: 12000,
      };

      expect(await controller.createRoom(HOTEL_ID, body, USER_ID)).toBe(room);
      expect(service.createRoom).toHaveBeenCalledWith(HOTEL_ID, body, USER_ID);
    });
  });

  describe('addRoomAvailability (HTL-04)', () => {
    it('gives the service the hotel id, the room id, the body and the logged-in user, and returns its answer', async () => {
      const { controller, service, room } = setup();
      const body: CreateRoomAvailabilityDto = {
        from: '2026-12-01',
        to: '2026-12-10',
      };

      expect(
        await controller.addRoomAvailability(HOTEL_ID, ROOM_ID, body, USER_ID),
      ).toBe(room);
      expect(service.addRoomAvailability).toHaveBeenCalledWith(
        HOTEL_ID,
        ROOM_ID,
        body,
        USER_ID,
      );
    });
  });

  describe('update (HTL-01)', () => {
    it('gives the service the hotel id, the body and the logged-in user, and returns its answer', async () => {
      const { controller, service, hotel } = setup();
      const body: UpdateHotelDto = {
        name: 'Cairo Garden Resort',
        starClass: 5,
      };

      expect(await controller.update(HOTEL_ID, body, USER_ID)).toBe(hotel);
      expect(service.update).toHaveBeenCalledWith(HOTEL_ID, body, USER_ID);
    });
  });

  describe('addPhotos (HTL-01)', () => {
    it('gives the service the hotel id, the logged-in user and the files, and returns its answer', async () => {
      const { controller, service, hotel } = setup();
      const files: ImageFile[] = [
        { originalname: 'lobby.jpg', buffer: Buffer.from('lobby') },
        { originalname: 'pool.png', buffer: Buffer.from('pool') },
      ];

      expect(await controller.addPhotos(HOTEL_ID, USER_ID, files)).toBe(hotel);
      expect(service.addPhotos).toHaveBeenCalledWith(HOTEL_ID, USER_ID, files);
    });

    it('passes on a request without files, so the service answers 400', async () => {
      const { controller, service } = setup();

      await controller.addPhotos(HOTEL_ID, USER_ID, undefined);

      expect(service.addPhotos).toHaveBeenCalledWith(
        HOTEL_ID,
        USER_ID,
        undefined,
      );
    });
  });

  describe('removePhoto (HTL-01)', () => {
    it('gives the service the hotel id, the logged-in user and the filename, in the service order, and returns its answer', async () => {
      const { controller, service, hotel } = setup();
      const filename = 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg';

      expect(await controller.removePhoto(HOTEL_ID, filename, USER_ID)).toBe(
        hotel,
      );
      expect(service.removePhoto).toHaveBeenCalledWith(
        HOTEL_ID,
        USER_ID,
        filename,
      );
    });
  });

  describe('routes', () => {
    it.each([
      ['create', '/', RequestMethod.POST, Role.Admin],
      ['createRoom', ':id/rooms', RequestMethod.POST, Role.HotelModerator],
      [
        'addRoomAvailability',
        ':id/rooms/:roomId/availability',
        RequestMethod.POST,
        Role.HotelModerator,
      ],
      ['update', ':id', RequestMethod.PATCH, Role.HotelModerator],
      ['addPhotos', ':id/photos', RequestMethod.POST, Role.HotelModerator],
      [
        'removePhoto',
        ':id/photos/:filename',
        RequestMethod.DELETE,
        Role.HotelModerator,
      ],
    ] as const)(
      '%s is at %s, needs a login and has the right method and role',
      (name, path, method, role) => {
        const handler = HotelsController.prototype[name];
        const reflector = new Reflector();

        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
        expect(reflector.get(ROLES_KEY, handler)).toEqual([role]);
        expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      },
    );

    it('is not public or role-restricted as a whole, so each route decides for itself', () => {
      const reflector = new Reflector();

      expect(reflector.get(IS_PUBLIC_KEY, HotelsController)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, HotelsController)).toBeUndefined();
    });

    it.each(['addPhotos', 'removePhoto'] as const)(
      '%s answers 200, not 201',
      (name) => {
        expect(
          Reflect.getMetadata(
            HTTP_CODE_METADATA,
            HotelsController.prototype[name],
          ),
        ).toBe(200);
      },
    );
  });
});
