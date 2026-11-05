import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

@Roles(Role.User, Role.Admin)
class ClassLevelController {
  inherited(): string {
    return 'ok';
  }

  @Roles(Role.Admin)
  adminOnly(): string {
    return 'ok';
  }
}

class OpenController {
  anyone(): string {
    return 'ok';
  }
}

function contextFor(
  controller: unknown,
  handler: unknown,
  user?: { id: string; role: Role },
): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const user = { id: '1', role: Role.User };
  const admin = { id: '2', role: Role.Admin };

  it('lets anyone through a route without @Roles()', () => {
    const context = contextFor(
      OpenController,
      OpenController.prototype.anyone,
      user,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('uses the roles set on the controller when the route sets none', () => {
    const context = contextFor(
      ClassLevelController,
      ClassLevelController.prototype.inherited,
      user,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('lets the route override the roles of the controller', () => {
    const handler = ClassLevelController.prototype.adminOnly;
    expect(
      guard.canActivate(contextFor(ClassLevelController, handler, admin)),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextFor(ClassLevelController, handler, user)),
    ).toThrow(ForbiddenException);
  });

  it('rejects a role that is not listed', () => {
    const hotelModerator = { id: '3', role: Role.HotelModerator };
    const context = contextFor(
      ClassLevelController,
      ClassLevelController.prototype.inherited,
      hotelModerator,
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('answers 401 instead of 403 when nobody is logged in', () => {
    const context = contextFor(
      ClassLevelController,
      ClassLevelController.prototype.adminOnly,
    );
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
