import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { LinkedBookingType } from './enums/linked-booking-type.enum';
import { ItineraryBookingsController } from './itinerary-bookings.controller';
import type { ItineraryBookingsService } from './itinerary-bookings.service';

/** The metadata key of @ApiResponse and its shortcuts, as the other controller specs read it. */
const API_RESPONSE = 'swagger/apiResponse';

describe('ItineraryBookingsController (ITN-27)', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const itineraryId = '6740f1c2a4b5c6d7e8f90789';
  const detail = { id: itineraryId } as ItineraryDetailResponseDto;

  function setup() {
    const itineraryBookings = { link: jest.fn().mockResolvedValue(detail) };
    const controller = new ItineraryBookingsController(
      itineraryBookings as unknown as ItineraryBookingsService,
    );
    return { itineraryBookings, controller };
  }

  it('gives the service the itinerary id, the body and the logged-in user, and returns its answer', async () => {
    const { itineraryBookings, controller } = setup();
    const dto = {
      dayId: '6741c0ffee0ddba11ad0d0d0',
      bookingType: LinkedBookingType.Hotel,
      bookingId: '6741c0ffee0ddba11ad0f0f0',
    };

    expect(await controller.link(itineraryId, dto, userId)).toBe(detail);
    expect(itineraryBookings.link).toHaveBeenCalledWith(
      itineraryId,
      dto,
      userId,
    );
  });

  it('is for registered users only', () => {
    const reflector = new Reflector();
    const handler = ItineraryBookingsController.prototype.link;

    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        ItineraryBookingsController,
      ]),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [
        handler,
        ItineraryBookingsController,
      ]),
    ).toEqual([Role.User]);
  });

  it('documents the created answer and every error status in Swagger', () => {
    const responses = Reflect.getMetadata(
      API_RESPONSE,
      ItineraryBookingsController.prototype.link,
    ) as Record<string, unknown>;

    expect(Object.keys(responses).sort()).toEqual([
      '201',
      '400',
      '403',
      '404',
      '409',
    ]);
  });
});
