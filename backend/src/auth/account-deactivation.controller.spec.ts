import { ConflictException, HttpStatus, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AccountDeactivationController } from './account-deactivation.controller';
import type { AccountDeactivationService } from './account-deactivation.service';
import type { AuthCookiesService } from './auth-cookies.service';
import { ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE } from './auth.constants';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const body: DeactivateAccountDto = { currentPassword: 'Passw0rdOK' };

function setup() {
  const deactivation = { deactivate: jest.fn().mockResolvedValue(undefined) };
  const authCookies = { clearAuthCookies: jest.fn() };
  const response = {} as Response;
  const controller = new AccountDeactivationController(
    deactivation as unknown as AccountDeactivationService,
    authCookies as unknown as AuthCookiesService,
  );
  return { controller, deactivation, authCookies, response };
}

describe('AccountDeactivationController (ACC-12)', () => {
  const handler = AccountDeactivationController.prototype.deactivateMyAccount;

  it('is DELETE /users/me', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, AccountDeactivationController),
    ).toBe('users');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('me');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.DELETE,
    );
  });

  it('needs a login and is only for registered users', () => {
    const reflector = new Reflector();

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
  });

  it('answers 204', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(
      HttpStatus.NO_CONTENT,
    );
  });

  it('validates the body with DeactivateAccountDto (the global pipe reads this type)', () => {
    const types = Reflect.getMetadata(
      'design:paramtypes',
      AccountDeactivationController.prototype,
      'deactivateMyAccount',
    ) as unknown[];

    expect(types[1]).toBe(DeactivateAccountDto);
  });

  it('deactivates the logged-in account, then clears both cookies, and returns nothing', async () => {
    const { controller, deactivation, authCookies, response } = setup();

    await expect(
      controller.deactivateMyAccount(USER_ID, body, response),
    ).resolves.toBeUndefined();

    expect(deactivation.deactivate).toHaveBeenCalledWith(USER_ID, body);
    expect(authCookies.clearAuthCookies).toHaveBeenCalledWith(response);
    const [deactivated] = deactivation.deactivate.mock.invocationCallOrder;
    const [cleared] = authCookies.clearAuthCookies.mock.invocationCallOrder;
    expect(deactivated).toBeLessThan(cleared);
  });

  it('keeps the cookies when the deactivation is refused', async () => {
    const { controller, deactivation, authCookies, response } = setup();
    deactivation.deactivate.mockRejectedValue(
      new ConflictException(ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE),
    );

    await expect(
      controller.deactivateMyAccount(USER_ID, body, response),
    ).rejects.toThrow(ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE);
    expect(authCookies.clearAuthCookies).not.toHaveBeenCalled();
  });
});
