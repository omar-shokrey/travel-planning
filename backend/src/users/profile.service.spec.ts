import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { Country } from '../reference/models/country.schema';
import { ProfileService } from './profile.service';
import type { UsersService } from './users.service';
import { UNSUPPORTED_CURRENCY_MESSAGE } from './users.constants';

const userId = '6740f1c2a4b5c6d7e8f90123';

function setup(currencySupported = true) {
  const stored = {
    _id: new Types.ObjectId(userId),
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    role: Role.User,
    status: UserStatus.Active,
    mustChangePassword: false,
    phone: '+20 10 1234 5678',
    preferredCurrency: 'EGP',
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
  };
  const usersService = {
    updateProfile: jest.fn().mockResolvedValue(stored),
    findEntityById: jest.fn().mockResolvedValue(stored),
  };
  const countries = {
    exists: jest.fn(() => ({
      exec: jest
        .fn()
        .mockResolvedValue(currencySupported ? { _id: 'EG' } : null),
    })),
  };
  const service = new ProfileService(
    usersService as unknown as UsersService,
    countries as unknown as Model<Country>,
  );
  return { usersService, countries, service };
}

describe('ProfileService', () => {
  describe('getMyProfile (ACC-11)', () => {
    it('returns the public account of the logged-in user', async () => {
      const { usersService, service } = setup();

      const account = await service.getMyProfile(userId);

      expect(usersService.findEntityById).toHaveBeenCalledWith(userId);
      expect(account).toEqual({
        id: userId,
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        role: Role.User,
        status: UserStatus.Active,
        mustChangePassword: false,
        phone: '+20 10 1234 5678',
        preferredCurrency: 'EGP',
        createdAt: '2026-11-14T10:00:00.000Z',
      });
    });

    it('looks up the account by the given id only and writes nothing', async () => {
      const { usersService, countries, service } = setup();

      await service.getMyProfile(userId);

      expect(usersService.findEntityById).toHaveBeenCalledTimes(1);
      expect(usersService.updateProfile).not.toHaveBeenCalled();
      expect(countries.exists).not.toHaveBeenCalled();
    });

    it('answers 401 when the account is gone', async () => {
      const { usersService, service } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      await expect(service.getMyProfile(userId)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('updateMyProfile (ACC-09)', () => {
    it('saves the fields that were sent for the logged-in user', async () => {
      const { usersService, service } = setup();

      await service.updateMyProfile(userId, {
        name: 'Sara A.',
        phone: '+20 10 1234 5678',
        preferredCurrency: 'EGP',
      });

      expect(usersService.updateProfile).toHaveBeenCalledWith(userId, {
        name: 'Sara A.',
        phone: '+20 10 1234 5678',
        preferredCurrency: 'EGP',
      });
    });

    it('checks the currency against the currencies of the countries list', async () => {
      const { countries, service } = setup();

      await service.updateMyProfile(userId, { preferredCurrency: 'EGP' });

      expect(countries.exists).toHaveBeenCalledWith({ currency: 'EGP' });
    });

    it('refuses an unsupported currency as a field error and saves nothing', async () => {
      const { usersService, service } = setup(false);

      const attempt = service.updateMyProfile(userId, {
        name: 'Sara A.',
        preferredCurrency: 'ZZZ',
      });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      const error = (await attempt.catch(
        (e: unknown) => e,
      )) as BadRequestException;
      expect(error.getResponse()).toMatchObject({
        message: 'Validation failed',
        errors: [
          {
            field: 'preferredCurrency',
            messages: [UNSUPPORTED_CURRENCY_MESSAGE],
          },
        ],
      });
      expect(usersService.updateProfile).not.toHaveBeenCalled();
    });

    it('does not look up the currency when it is not sent or is removed', async () => {
      const { countries, service } = setup();

      await service.updateMyProfile(userId, { name: 'Sara' });
      await service.updateMyProfile(userId, { preferredCurrency: null });

      expect(countries.exists).not.toHaveBeenCalled();
    });

    it('returns the public account with the profile fields', async () => {
      const { service } = setup();

      const account = await service.updateMyProfile(userId, { name: 'Sara' });

      expect(account).toMatchObject({
        id: userId,
        name: 'Sara Ahmed',
        phone: '+20 10 1234 5678',
        preferredCurrency: 'EGP',
      });
    });

    it('answers 401 when the account is gone', async () => {
      const { usersService, service } = setup();
      usersService.updateProfile.mockResolvedValue(null);

      await expect(
        service.updateMyProfile(userId, { name: 'Sara' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
