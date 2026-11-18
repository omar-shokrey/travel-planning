import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { BudgetsController } from './budgets.controller';
import type { BudgetsService } from './budgets.service';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { UpdateBudgetEntryDto } from './dto/update-budget-entry.dto';

describe('BudgetsController (ITN-14)', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const entryId = '6740f1c2a4b5c6d7e8f90456';
  const itinerary = {
    id: '6740f1c2a4b5c6d7e8f90789',
  } as ItineraryDetailResponseDto;

  function setup() {
    const budgetsService = {
      update: jest.fn().mockResolvedValue(itinerary),
      remove: jest.fn().mockResolvedValue(itinerary),
    };
    const controller = new BudgetsController(
      budgetsService as unknown as BudgetsService,
    );
    return { budgetsService, controller };
  }

  /** Every budget route needs a login as a registered user (ITN-01). */
  function expectRegisteredUsersOnly(handler: (...args: never[]) => unknown) {
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, BudgetsController]),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [handler, BudgetsController]),
    ).toEqual([Role.User]);
  }

  describe('update', () => {
    it('gives the service the entry id, the body and the logged-in user, and returns its answer', async () => {
      const { budgetsService, controller } = setup();
      const body: UpdateBudgetEntryDto = { amount: 2500 };

      expect(await controller.update(entryId, body, userId)).toBe(itinerary);
      expect(budgetsService.update).toHaveBeenCalledWith(entryId, body, userId);
    });

    it('is for registered users only', () => {
      expectRegisteredUsersOnly(BudgetsController.prototype.update);
    });
  });

  describe('remove', () => {
    it('gives the service the entry id and the logged-in user, and returns its answer', async () => {
      const { budgetsService, controller } = setup();

      expect(await controller.remove(entryId, userId)).toBe(itinerary);
      expect(budgetsService.remove).toHaveBeenCalledWith(entryId, userId);
    });

    it('is for registered users only', () => {
      expectRegisteredUsersOnly(BudgetsController.prototype.remove);
    });
  });
});
