import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { ActivitiesService } from './activities.service';
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
    findMine: jest.fn(),
    findOne: jest.fn(),
    addDay: jest.fn(),
    updateDay: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const activities = { add: jest.fn() };
  const controller = new ItinerariesController(
    service as unknown as ItinerariesService,
    activities as unknown as ActivitiesService,
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

  it('passes the page and the logged-in user to the list and the detail', async () => {
    const query = new PaginationQueryDto();
    const page = { items: [], meta: { page: 1, limit: 10, total: 0 } };
    service.findMine.mockResolvedValue(page);
    service.findOne.mockResolvedValue({ id, days: [] });

    await expect(controller.findMine(query, userId)).resolves.toBe(page);
    await expect(controller.findOne(id, userId)).resolves.toEqual({
      id,
      days: [],
    });

    expect(service.findMine).toHaveBeenCalledWith(query, userId);
    expect(service.findOne).toHaveBeenCalledWith(id, userId);
  });

  it('passes the day, the ids and the logged-in user to the service', async () => {
    const dayId = '6741c0ffee0ddba11ad0d0d0';
    const day = { cityId: 'cairo', notes: 'Pyramids' };
    service.addDay.mockResolvedValue({ id, days: [{ id: dayId }] });
    service.updateDay.mockResolvedValue({ id, days: [{ id: dayId }] });

    await controller.addDay(id, day, userId);
    await controller.updateDay(id, dayId, { notes: 'Museum' }, userId);

    expect(service.addDay).toHaveBeenCalledWith(id, day, userId);
    expect(service.updateDay).toHaveBeenCalledWith(
      id,
      dayId,
      { notes: 'Museum' },
      userId,
    );
  });

  it('passes a new activity, the ids and the logged-in user to the activities service', async () => {
    const dayId = '6741c0ffee0ddba11ad0d0d0';
    const activity = { name: 'Museum', cost: 2000, currency: 'EGP' };
    activities.add.mockResolvedValue({ id });

    await controller.addActivity(id, dayId, activity, userId);

    expect(activities.add).toHaveBeenCalledWith(id, dayId, activity, userId);
  });
});
