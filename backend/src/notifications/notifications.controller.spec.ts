import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import type {
  MarkAllReadResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import { NotificationsController } from './notifications.controller';
import type { NotificationsService } from './notifications.service';

describe('NotificationsController (GEN-01)', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const notificationId = '6740f1c2a4b5c6d7e8f90456';
  const notification = { id: notificationId } as NotificationResponseDto;
  const page = {
    items: [notification],
    total: 1,
  } as unknown as PaginatedResponse<NotificationResponseDto>;
  const unread: UnreadCountResponseDto = { count: 3 };
  const markedAll: MarkAllReadResponseDto = { updated: 2 };

  function setup() {
    const service = {
      list: jest.fn().mockResolvedValue(page),
      unreadCount: jest.fn().mockResolvedValue(unread),
      markAllRead: jest.fn().mockResolvedValue(markedAll),
      markRead: jest.fn().mockResolvedValue(notification),
    };
    const controller = new NotificationsController(
      service as unknown as NotificationsService,
    );
    return { service, controller };
  }

  // Every route needs a login and is open to every role: each user only ever
  // reaches their own notifications.
  function expectLoginForEveryRole(
    handler: (...args: never[]) => unknown,
  ): void {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(
      reflector.get(IS_PUBLIC_KEY, NotificationsController),
    ).toBeUndefined();
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, NotificationsController)).toBeUndefined();
  }

  describe('list', () => {
    it('gives the service the logged-in user and the query, and returns its answer', async () => {
      const { service, controller } = setup();
      const query = { page: 1, limit: 10 } as ListNotificationsQueryDto;

      expect(await controller.list(userId, query)).toBe(page);
      expect(service.list).toHaveBeenCalledWith(userId, query);
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(NotificationsController.prototype.list);
    });
  });

  describe('unreadCount', () => {
    it('gives the service the logged-in user and returns its answer', async () => {
      const { service, controller } = setup();

      expect(await controller.unreadCount(userId)).toBe(unread);
      expect(service.unreadCount).toHaveBeenCalledWith(userId);
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(NotificationsController.prototype.unreadCount);
    });
  });

  describe('markAllRead', () => {
    it('gives the service the logged-in user and returns its answer', async () => {
      const { service, controller } = setup();

      expect(await controller.markAllRead(userId)).toBe(markedAll);
      expect(service.markAllRead).toHaveBeenCalledWith(userId);
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(NotificationsController.prototype.markAllRead);
    });
  });

  describe('markRead', () => {
    it('gives the service the logged-in user and the notification id, and returns its answer', async () => {
      const { service, controller } = setup();

      expect(await controller.markRead(userId, notificationId)).toBe(
        notification,
      );
      expect(service.markRead).toHaveBeenCalledWith(userId, notificationId);
    });

    it('needs a login, and is open to every role', () => {
      expectLoginForEveryRole(NotificationsController.prototype.markRead);
    });
  });
});
