import { HotelRoomStatusController } from './hotel-room-status.controller';
import type { HotelRoomStatusService } from './hotel-room-status.service';
import type { RoomStatusQueryDto } from './dto/room-status-query.dto';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const USER_ID = '6740f1c2a4b5c6d7e8f90124';

describe('HotelRoomStatusController (HTL-08)', () => {
  it('passes the hotel id, the query and the logged-in user to the service', async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { findStatus: jest.fn().mockResolvedValue(page) };
    const controller = new HotelRoomStatusController(
      service as unknown as HotelRoomStatusService,
    );
    const query = {
      from: '2026-12-01',
      to: '2026-12-15',
      page: 1,
      limit: 10,
    } as RoomStatusQueryDto;

    expect(await controller.findStatus(HOTEL_ID, query, USER_ID)).toBe(page);
    expect(service.findStatus).toHaveBeenCalledWith(HOTEL_ID, query, USER_ID);
  });
});
