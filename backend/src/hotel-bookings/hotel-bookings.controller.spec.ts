import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
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

  it('is open to registered users only', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, HotelBookingsController.prototype.create),
    ).toEqual([Role.User]);
  });
});
