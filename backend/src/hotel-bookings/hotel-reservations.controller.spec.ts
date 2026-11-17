import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { HotelReservationsController } from './hotel-reservations.controller';
import type { HotelReservationsService } from './hotel-reservations.service';

describe('HotelReservationsController (HTL-22)', () => {
  it('passes the hotel, the query and the moderator to the service', async () => {
    const page = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    const service = { findForHotel: jest.fn().mockResolvedValue(page) };
    const controller = new HotelReservationsController(
      service as unknown as HotelReservationsService,
    );
    const query = { page: 1, limit: 10 } as HotelReservationsQueryDto;

    expect(await controller.findForHotel('h1', query, 'm1')).toBe(page);
    expect(service.findForHotel).toHaveBeenCalledWith('h1', query, 'm1');
  });

  it('is open to hotel moderators only', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        HotelReservationsController.prototype.findForHotel,
      ),
    ).toEqual([Role.HotelModerator]);
  });
});
