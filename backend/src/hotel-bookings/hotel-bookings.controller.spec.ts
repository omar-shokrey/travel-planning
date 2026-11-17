import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import type { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings-query.dto';
import { HotelBookingsController } from './hotel-bookings.controller';
import type { HotelBookingsService } from './hotel-bookings.service';

describe('HotelBookingsController (HTL-16, HTL-18)', () => {
  it('reserves for the logged-in user and returns the reservation', async () => {
    const booking = { id: 'b1', status: 'pending_payment' };
    const service = { create: jest.fn().mockResolvedValue(booking) };
    const controller = new HotelBookingsController(
      service as unknown as HotelBookingsService,
    );
    const dto = { hotelId: 'h1' } as CreateHotelBookingDto;

    expect(await controller.create(dto, 'u1')).toBe(booking);
    expect(service.create).toHaveBeenCalledWith('u1', dto);
  });

  it("lists the logged-in user's reservations (HTL-20)", async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { findMine: jest.fn().mockResolvedValue(page) };
    const controller = new HotelBookingsController(
      service as unknown as HotelBookingsService,
    );
    const query = { page: 1, limit: 10 } as ListHotelBookingsQueryDto;

    expect(await controller.findMine(query, 'u1')).toBe(page);
    expect(service.findMine).toHaveBeenCalledWith('u1', query);
  });

  it('opens one reservation for the logged-in user (HTL-20)', async () => {
    const booking = { id: 'b1' };
    const service = { findMineById: jest.fn().mockResolvedValue(booking) };
    const controller = new HotelBookingsController(
      service as unknown as HotelBookingsService,
    );

    expect(await controller.findMineById('b1', 'u1')).toBe(booking);
    expect(service.findMineById).toHaveBeenCalledWith('b1', 'u1');
  });

  it.each(['create', 'findMine', 'findMineById'] as const)(
    '%s is open to registered users only',
    (method) => {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          HotelBookingsController.prototype[method],
        ),
      ).toEqual([Role.User]);
    },
  );
});
