import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AirportsController } from './airports.controller';
import type { AirportsService } from './airports.service';

describe('AirportsController', () => {
  const service = { findAll: jest.fn() };
  const controller = new AirportsController(
    service as unknown as AirportsService,
  );

  it('passes the page to the service and returns its answer', async () => {
    const query = new PaginationQueryDto();
    const page = { items: [], meta: { page: 1, limit: 10, total: 0 } };
    service.findAll.mockResolvedValue(page);

    await expect(controller.findAll(query)).resolves.toBe(page);
    expect(service.findAll).toHaveBeenCalledWith(query);
  });

  it('is open to guests', () => {
    const isPublic = new Reflector().get<boolean>(
      IS_PUBLIC_KEY,
      AirportsController.prototype.findAll,
    );

    expect(isPublic).toBe(true);
  });
});
