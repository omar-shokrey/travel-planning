import { REQUIRE_VERIFIED_EMAIL_KEY } from '../auth/decorators/require-verified-email.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingCancellationController } from './hotel-booking-cancellation.controller';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelReservationsController } from './hotel-reservations.controller';
import { HotelReviewsController } from './reviews.controller';
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

describe('HotelBookingsController: a verified email to book (ACC-02)', () => {
  it.each([
    [
      'HotelReservationsController.list',
      HotelReservationsController.prototype.list,
    ],
    [
      'HotelReservationsController.findOne',
      HotelReservationsController.prototype.findOne,
    ],
    [
      'HotelBookingCancellationController.cancellationPreview',
      HotelBookingCancellationController.prototype.cancellationPreview,
    ],
    [
      'HotelBookingCancellationController.cancel',
      HotelBookingCancellationController.prototype.cancel,
    ],
    ['HotelReviewsController.create', HotelReviewsController.prototype.create],
  ])('leaves %s open to an unverified account', (_name, handler) => {
    expect(
      Reflect.getMetadata(REQUIRE_VERIFIED_EMAIL_KEY, handler),
    ).toBeUndefined();
  });

  it('marks create, which holds the rooms', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_VERIFIED_EMAIL_KEY,
        HotelBookingsController.prototype.create,
      ),
    ).toBe(true);
  });
});
