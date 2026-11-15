import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import type { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import { ACCOUNT_SUSPENDED_MESSAGE } from './auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Passw0rdOK',
  acceptedTerms: true,
};

const created: UserResponseDto = {
  id: '6740f1c2a4b5c6d7e8f90123',
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  role: Role.User,
  status: UserStatus.Active,
  createdAt: '2026-11-14T10:00:00.000Z',
};

const loginDto: LoginDto = {
  email: 'sara@example.com',
  password: 'Passw0rdOK',
};

const tokens = {
  accessToken: 'an-access-token',
  refreshToken: 'a-refresh-token',
};

function setup() {
  const authService = {
    register: jest.fn().mockResolvedValue(created),
    login: jest.fn().mockResolvedValue({ user: created, tokens }),
    logout: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue({ user: created, tokens }),
    me: jest.fn().mockResolvedValue(created),
  };
  const authCookies = {
    setAuthCookies: jest.fn(),
    clearAuthCookies: jest.fn(),
    // The request below is a stand-in; the cookies it carries are told here.
    readAccessToken: jest.fn().mockReturnValue('an-access-token'),
    readRefreshToken: jest.fn().mockReturnValue('a-refresh-token'),
  };
  const request = {} as Request;
  const response = {} as Response;
  const controller = new AuthController(
    authService as unknown as AuthService,
    authCookies as unknown as AuthCookiesService,
  );

  return { authService, authCookies, request, response, controller };
}

describe('AuthController', () => {
  describe('register (ACC-01)', () => {
    it('hands the body to the service and returns its answer', async () => {
      const { authService, controller } = setup();

      expect(await controller.register(dto)).toBe(created);
      expect(authService.register).toHaveBeenCalledWith(dto);
    });

    it('is open to guests', () => {
      // The authentication guard (ACC-04) lets a route through only if it is public.
      expect(
        new Reflector().get<boolean>(
          IS_PUBLIC_KEY,
          AuthController.prototype.register,
        ),
      ).toBe(true);
    });
  });

  describe('login (ACC-04)', () => {
    it('hands the body to the service and returns the user', async () => {
      const { authService, response, controller } = setup();

      expect(await controller.login(loginDto, response)).toBe(created);
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });

    it('sets the authentication cookies and keeps the tokens out of the body', async () => {
      const { authCookies, response, controller } = setup();

      const body = await controller.login(loginDto, response);

      expect(authCookies.setAuthCookies).toHaveBeenCalledWith(response, tokens);
      expect(JSON.stringify(body)).not.toContain(tokens.accessToken);
      expect(JSON.stringify(body)).not.toContain(tokens.refreshToken);
    });

    it('sets no cookie when the login fails', async () => {
      const { authService, authCookies, response, controller } = setup();
      const suspended = new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
      authService.login.mockRejectedValueOnce(suspended);

      await expect(controller.login(loginDto, response)).rejects.toBe(
        suspended,
      );
      expect(authCookies.setAuthCookies).not.toHaveBeenCalled();
    });

    it('is open to guests', () => {
      expect(
        new Reflector().get<boolean>(
          IS_PUBLIC_KEY,
          AuthController.prototype.login,
        ),
      ).toBe(true);
    });
  });

  describe('logout (ACC-06)', () => {
    it('hands the tokens of the request to the service and clears both cookies', async () => {
      const { authService, authCookies, request, response, controller } =
        setup();

      await expect(
        controller.logout(request, response),
      ).resolves.toBeUndefined();

      expect(authCookies.readRefreshToken).toHaveBeenCalledWith(request);
      expect(authCookies.readAccessToken).toHaveBeenCalledWith(request);
      expect(authService.logout).toHaveBeenCalledWith({
        refreshToken: 'a-refresh-token',
        accessToken: 'an-access-token',
      });
      expect(authCookies.clearAuthCookies).toHaveBeenCalledWith(response);
    });

    it('revokes the session before it clears the cookies', async () => {
      const { authService, authCookies, request, response, controller } =
        setup();

      await controller.logout(request, response);

      const [revoked] = authService.logout.mock.invocationCallOrder;
      const [cleared] = authCookies.clearAuthCookies.mock.invocationCallOrder;
      expect(revoked).toBeLessThan(cleared);
    });

    it('clears the cookies even when the request carries none', async () => {
      const { authService, authCookies, request, response, controller } =
        setup();
      authCookies.readAccessToken.mockReturnValue(undefined);
      authCookies.readRefreshToken.mockReturnValue(undefined);

      await controller.logout(request, response);

      expect(authService.logout).toHaveBeenCalledWith({
        refreshToken: undefined,
        accessToken: undefined,
      });
      expect(authCookies.clearAuthCookies).toHaveBeenCalledWith(response);
    });

    it('is open to everyone, so an expired access token cannot block it', () => {
      expect(
        new Reflector().get<boolean>(
          IS_PUBLIC_KEY,
          AuthController.prototype.logout,
        ),
      ).toBe(true);
    });
  });

  describe('refresh (ACC-06)', () => {
    it('hands the refresh token of the request to the service and returns the user', async () => {
      const { authService, authCookies, request, response, controller } =
        setup();

      expect(await controller.refresh(request, response)).toBe(created);

      expect(authCookies.readRefreshToken).toHaveBeenCalledWith(request);
      expect(authService.refresh).toHaveBeenCalledWith('a-refresh-token');
    });

    it('sets the new cookies and keeps the tokens out of the body', async () => {
      const { authCookies, request, response, controller } = setup();

      const body = await controller.refresh(request, response);

      expect(authCookies.setAuthCookies).toHaveBeenCalledWith(response, tokens);
      expect(JSON.stringify(body)).not.toContain(tokens.accessToken);
      expect(JSON.stringify(body)).not.toContain(tokens.refreshToken);
    });

    it('sets no cookie, and keeps the old ones, when the refresh fails', async () => {
      const { authService, authCookies, request, response, controller } =
        setup();
      const refused = new UnauthorizedException('You must log in to do this');
      authService.refresh.mockRejectedValueOnce(refused);

      await expect(controller.refresh(request, response)).rejects.toBe(refused);
      expect(authCookies.setAuthCookies).not.toHaveBeenCalled();
      expect(authCookies.clearAuthCookies).not.toHaveBeenCalled();
    });

    it('passes undefined to the service when the request has no refresh cookie', async () => {
      const { authService, authCookies, request, response, controller } =
        setup();
      authCookies.readRefreshToken.mockReturnValue(undefined);

      await controller.refresh(request, response);

      expect(authService.refresh).toHaveBeenCalledWith(undefined);
    });

    it('is open to everyone, because the access token is what has expired', () => {
      expect(
        new Reflector().get<boolean>(
          IS_PUBLIC_KEY,
          AuthController.prototype.refresh,
        ),
      ).toBe(true);
    });
  });

  describe('me (ACC-04)', () => {
    it('gives the service the id of the logged-in user and returns its answer', async () => {
      const { authService, controller } = setup();

      expect(await controller.me(created.id)).toBe(created);
      expect(authService.me).toHaveBeenCalledWith(created.id);
    });

    it('needs a login', () => {
      expect(
        new Reflector().get<boolean | undefined>(
          IS_PUBLIC_KEY,
          AuthController.prototype.me,
        ),
      ).toBeUndefined();
    });
  });
});
