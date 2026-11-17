import type { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { HotelAvailableRoomsController } from './hotel-available-rooms.controller';
import type { HotelAvailableRoomsService } from './hotel-available-rooms.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';

describe('HotelAvailableRoomsController (HTL-15)', () => {
  it('passes the hotel id and the stay to the service', async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { findAvailable: jest.fn().mockResolvedValue(page) };
    const controller = new HotelAvailableRoomsController(
      service as unknown as HotelAvailableRoomsService,
    );
    const query = {
      checkIn: '2026-12-10',
      checkOut: '2026-12-13',
      page: 1,
      limit: 10,
    } as AvailableRoomsQueryDto;

    expect(await controller.findAvailable(HOTEL_ID, query)).toBe(page);
    expect(service.findAvailable).toHaveBeenCalledWith(HOTEL_ID, query);
  });
});
