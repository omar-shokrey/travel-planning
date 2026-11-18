import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Role } from '../common/enums/role.enum';
import type { ActivitiesService } from './activities.service';
import type { BudgetsService } from './budgets.service';
import { BudgetCategory } from './enums/budget-category.enum';
import { ItinerariesController } from './itineraries.controller';
import type { TransportCostsService } from './transport-costs.service';
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
  const transportCosts = { add: jest.fn() };
  const budgets = { add: jest.fn(), summary: jest.fn() };
  const controller = new ItinerariesController(
    service as unknown as ItinerariesService,
    activities as unknown as ActivitiesService,
    transportCosts as unknown as TransportCostsService,
    budgets as unknown as BudgetsService,
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

  it('passes a new transport cost and the logged-in user to the transport costs service', async () => {
    const cost = {
      dayId: '6741c0ffee0ddba11ad0d0d0',
      mode: 'train',
      fromCityId: 'cairo',
      toCityId: 'luxor',
      amount: 90000,
      currency: 'EGP',
    };
    transportCosts.add.mockResolvedValue({ id });

    await controller.addTransportCost(id, cost, userId);

    expect(transportCosts.add).toHaveBeenCalledWith(id, cost, userId);
  });

  it('passes a new budget entry, the ids and the logged-in user to the budgets service (ITN-14)', async () => {
    const dayId = '6741c0ffee0ddba11ad0d0d0';
    const entry = {
      category: BudgetCategory.Food,
      amount: 45000,
      currency: 'EGP',
    };
    budgets.add.mockResolvedValue({ id, days: [] });

    await expect(
      controller.addBudgetEntry(id, dayId, entry, userId),
    ).resolves.toEqual({ id, days: [] });
    expect(budgets.add).toHaveBeenCalledWith(id, dayId, entry, userId);
  });

  it('passes the itinerary id and the logged-in user to the budget summary (ITN-14)', async () => {
    const summary = { itineraryId: id, total: [], byCategory: [], byDay: [] };
    budgets.summary.mockResolvedValue(summary);

    await expect(controller.budgetSummary(id, userId)).resolves.toBe(summary);
    expect(budgets.summary).toHaveBeenCalledWith(id, userId);
  });

  it('is for registered users only (ITN-01): the class needs a login and Role.User, and no route changes that', () => {
    const reflector = new Reflector();
    const handlers = Object.getOwnPropertyNames(ItinerariesController.prototype)
      .filter((name) => name !== 'constructor')
      .map(
        (name) =>
          (
            ItinerariesController.prototype as unknown as Record<
              string,
              () => unknown
            >
          )[name],
      );

    expect(handlers.length).toBeGreaterThan(0);
    expect(reflector.get(IS_PUBLIC_KEY, ItinerariesController)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, ItinerariesController)).toEqual([
      Role.User,
    ]);
    for (const handler of handlers) {
      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
      expect(
        reflector.getAllAndOverride(ROLES_KEY, [
          handler,
          ItinerariesController,
        ]),
      ).toEqual([Role.User]);
    }
  });
});
