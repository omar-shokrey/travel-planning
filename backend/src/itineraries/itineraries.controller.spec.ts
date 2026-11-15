import { ItinerariesController } from './itineraries.controller';
import type { ItinerariesService } from './itineraries.service';

const id = '6741c0ffee0ddba11ad0c0de';
const userId = '6741c0ffee0ddba11ad0beef';
const dto = {
  title: 'Ten days in Egypt',
  countries: ['EG'],
  startDate: '2026-12-20',
};

describe('ItinerariesController', () => {
  const service = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new ItinerariesController(
    service as unknown as ItinerariesService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('passes the body and the logged-in user to the service', async () => {
    service.create.mockResolvedValue({ id });
    service.update.mockResolvedValue({ id });

    await expect(controller.create(dto, userId)).resolves.toEqual({ id });
    await expect(controller.update(id, dto, userId)).resolves.toEqual({ id });
    await controller.remove(id, userId);

    expect(service.create).toHaveBeenCalledWith(dto, userId);
    expect(service.update).toHaveBeenCalledWith(id, dto, userId);
    expect(service.remove).toHaveBeenCalledWith(id, userId);
  });
});
