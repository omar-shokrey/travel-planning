import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { ImageFile } from '../uploads/uploads.types';
import type { CreateHotelDto } from './dto/create-hotel.dto';
import type { CreateRoomAvailabilityDto } from './dto/create-room-availability.dto';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { HotelResponseDto } from './dto/hotel-response.dto';
import type { RoomResponseDto } from './dto/room-response.dto';
import type { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelsController } from './hotels.controller';
import type { HotelsService } from './hotels.service';

describe('HotelsController', () => {
  const hotelId = '6740f1c2a4b5c6d7e8f90111';
  const roomId = '6740f1c2a4b5c6d7e8f90222';
  const userId = '6740f1c2a4b5c6d7e8f90333';
  const hotel = { id: hotelId } as HotelResponseDto;
  const room = { id: roomId } as RoomResponseDto;

  function setup() {
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
    return { service, controller };
  }

  /** The route needs a login (not @Public) and only this role. */
  function expectOnly(
    handler: (...args: never[]) => unknown,
    role: Role,
  ): void {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get(IS_PUBLIC_KEY, HotelsController)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, handler)).toEqual([role]);
  }

  it('create (HTL-01): passes the body to the service and returns its answer; admins only', async () => {
    const { service, controller } = setup();
    const dto = { name: 'Nile View' } as CreateHotelDto;

    expect(await controller.create(dto)).toBe(hotel);
    expect(service.create).toHaveBeenCalledWith(dto);
    expectOnly(HotelsController.prototype.create, Role.Admin);
  });

  it('update (HTL-01): passes the hotel, the body and the logged-in moderator; hotel moderators only', async () => {
    const { service, controller } = setup();
    const dto = { description: 'Rooms on the Nile' } as UpdateHotelDto;

    expect(await controller.update(hotelId, dto, userId)).toBe(hotel);
    expect(service.update).toHaveBeenCalledWith(hotelId, dto, userId);
    expectOnly(HotelsController.prototype.update, Role.HotelModerator);
  });

  it('addPhotos (HTL-01, GEN-08): passes the hotel, the moderator and the files; hotel moderators only', async () => {
    const { service, controller } = setup();
    const files = [{ originalname: 'a.jpg' }] as ImageFile[];

    expect(await controller.addPhotos(hotelId, userId, files)).toBe(hotel);
    expect(service.addPhotos).toHaveBeenCalledWith(hotelId, userId, files);
    expectOnly(HotelsController.prototype.addPhotos, Role.HotelModerator);
  });

  it('removePhoto (HTL-01, GEN-08): passes the hotel, the moderator and the file name; hotel moderators only', async () => {
    const { service, controller } = setup();

    expect(await controller.removePhoto(hotelId, 'a.jpg', userId)).toBe(hotel);
    expect(service.removePhoto).toHaveBeenCalledWith(hotelId, userId, 'a.jpg');
    expectOnly(HotelsController.prototype.removePhoto, Role.HotelModerator);
  });

  it('createRoom: passes the hotel, the body and the moderator; hotel moderators only', async () => {
    const { service, controller } = setup();
    const dto = { name: 'Double' } as unknown as CreateRoomDto;

    expect(await controller.createRoom(hotelId, dto, userId)).toBe(room);
    expect(service.createRoom).toHaveBeenCalledWith(hotelId, dto, userId);
    expectOnly(HotelsController.prototype.createRoom, Role.HotelModerator);
  });

  it('addRoomAvailability: passes the hotel, the room, the body and the moderator; hotel moderators only', async () => {
    const { service, controller } = setup();
    const dto = {} as CreateRoomAvailabilityDto;

    expect(
      await controller.addRoomAvailability(hotelId, roomId, dto, userId),
    ).toBe(room);
    expect(service.addRoomAvailability).toHaveBeenCalledWith(
      hotelId,
      roomId,
      dto,
      userId,
    );
    expectOnly(
      HotelsController.prototype.addRoomAvailability,
      Role.HotelModerator,
    );
  });
});
