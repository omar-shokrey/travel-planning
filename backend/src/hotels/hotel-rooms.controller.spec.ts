import { HotelRoomsController } from './hotel-rooms.controller';
import type { HotelRoomsService } from './hotel-rooms.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const ROOM_ID = '6740f1c2a4b5c6d7e8f90124';
const USER_ID = '6740f1c2a4b5c6d7e8f90125';

describe('HotelRoomsController', () => {
  const setup = () => {
    const service = {
      update: jest.fn(),
      setAvailability: jest.fn(),
      deactivate: jest.fn(),
      reactivate: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new HotelRoomsController(
      service as unknown as HotelRoomsService,
    );
    return { controller, service };
  };

  it('passes the hotel, the room, the changes and the logged-in user to the service', async () => {
    const { controller, service } = setup();
    const room = { id: ROOM_ID, beds: 3 };
    service.update.mockResolvedValue(room);
    const dto = { beds: 3 };

    expect(await controller.update(HOTEL_ID, ROOM_ID, dto, USER_ID)).toBe(room);
    expect(service.update).toHaveBeenCalledWith(
      HOTEL_ID,
      ROOM_ID,
      dto,
      USER_ID,
    );
  });

  it('passes the new availability and blocks and the logged-in user to the service', async () => {
    const { controller, service } = setup();
    const room = { id: ROOM_ID, availability: [], blocked: [] };
    service.setAvailability.mockResolvedValue(room);
    const dto = {
      availability: [{ from: '2026-12-01', to: '2026-12-08' }],
      blocked: [{ from: '2026-12-03', to: '2026-12-04' }],
    };

    expect(
      await controller.setAvailability(HOTEL_ID, ROOM_ID, dto, USER_ID),
    ).toBe(room);
    expect(service.setAvailability).toHaveBeenCalledWith(
      HOTEL_ID,
      ROOM_ID,
      dto,
      USER_ID,
    );
  });

  it('deactivates and reactivates the room for the logged-in user', async () => {
    const { controller, service } = setup();
    service.deactivate.mockResolvedValue({ active: false });
    service.reactivate.mockResolvedValue({ active: true });

    expect(await controller.deactivate(HOTEL_ID, ROOM_ID, USER_ID)).toEqual({
      active: false,
    });
    expect(await controller.reactivate(HOTEL_ID, ROOM_ID, USER_ID)).toEqual({
      active: true,
    });
    expect(service.deactivate).toHaveBeenCalledWith(HOTEL_ID, ROOM_ID, USER_ID);
    expect(service.reactivate).toHaveBeenCalledWith(HOTEL_ID, ROOM_ID, USER_ID);
  });

  it('deletes the room for the logged-in user and returns nothing', async () => {
    const { controller, service } = setup();
    service.remove.mockResolvedValue(undefined);

    expect(await controller.remove(HOTEL_ID, ROOM_ID, USER_ID)).toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(HOTEL_ID, ROOM_ID, USER_ID);
  });
});
