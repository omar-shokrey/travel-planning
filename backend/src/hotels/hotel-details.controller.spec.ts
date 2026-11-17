import { HotelDetailsController } from './hotel-details.controller';
import type { HotelDetailsService } from './hotel-details.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';

describe('HotelDetailsController', () => {
  it('returns the hotel the service finds for the id', async () => {
    const hotel = { id: HOTEL_ID, name: 'Cairo Garden Hotel' };
    const service = { findActiveById: jest.fn().mockResolvedValue(hotel) };
    const controller = new HotelDetailsController(
      service as unknown as HotelDetailsService,
    );

    expect(await controller.findOne(HOTEL_ID)).toBe(hotel);
    expect(service.findActiveById).toHaveBeenCalledWith(HOTEL_ID);
  });
});
