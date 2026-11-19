import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
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

    expect(await controller.findOne(HOTEL_ID, {})).toBe(hotel);
    expect(service.findActiveById).toHaveBeenCalledWith(HOTEL_ID, {});
  });

  it('passes the dates of the stay to the service (HTL-15)', async () => {
    const service = { findActiveById: jest.fn().mockResolvedValue({}) };
    const controller = new HotelDetailsController(
      service as unknown as HotelDetailsService,
    );
    const query = { checkIn: '2026-12-10', checkOut: '2026-12-13' };

    await controller.findOne(HOTEL_ID, query);

    expect(service.findActiveById).toHaveBeenCalledWith(HOTEL_ID, query);
  });

  it('is the public GET /hotels/:id', () => {
    const handler = HotelDetailsController.prototype.findOne;

    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
  });
});
