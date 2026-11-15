import { ConflictException } from '@nestjs/common';
import { compare } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { User } from './models/user.schema';
import {
  EMAIL_TAKEN_MESSAGE,
  UsersService,
  type CreateUserInput,
  type LockoutPolicy,
} from './users.service';

const input: CreateUserInput = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Passw0rdOK',
  consentAcceptedAt: new Date('2026-11-14T10:00:00.000Z'),
};

/** What the service hands to the model. */
type StoredFields = Record<string, unknown>;

function setup(
  existing: { _id: string } | null = null,
  found: object | null = null,
) {
  // The query that `findOne` and `findById` give back, ended with exec().
  const exec = jest.fn().mockResolvedValue(found);
  const select = jest.fn(() => ({ exec }));
  const model = {
    exists: jest.fn().mockResolvedValue(existing),
    // Answers with what it was given, as a saved document would.
    create: jest.fn((fields: StoredFields) => Promise.resolve(fields)),
    findOne: jest.fn(() => ({ select })),
    findById: jest.fn(() => ({ exec })),
  };
  const service = new UsersService(model as unknown as Model<User>);
  const storedFields = (): StoredFields => model.create.mock.calls[0][0];

  return { model, select, service, storedFields };
}

/** The lockout of ACC-05, as the auth service gives it: 5 failures, 15 minutes. */
const policy: LockoutPolicy = { maxAttempts: 5, lockMs: 15 * 60_000 };
const now = new Date('2026-11-15T12:00:00.000Z');
const userObjectId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');

/**
 * A model for the lockout methods. `counted` is what `findByIdAndUpdate`
 * finds after it added one failed login (`null`: there is no such account).
 */
function setupLockout(counted: { failedLoginAttempts: number } | null) {
  const countExec = jest.fn().mockResolvedValue(counted);
  const countSelect = jest.fn(() => ({ exec: countExec }));
  const updateExec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const model = {
    findByIdAndUpdate: jest.fn(() => ({ select: countSelect })),
    updateOne: jest.fn(() => ({ exec: updateExec })),
  };
  const service = new UsersService(model as unknown as Model<User>);

  return { model, countSelect, service };
}

describe('UsersService', () => {
  describe('createRegisteredUser (ACC-01)', () => {
    it('stores a bcrypt hash and never the plain password', async () => {
      const { service, storedFields } = setup();

      await service.createRegisteredUser(input);

      const { passwordHash, ...others } = storedFields();
      expect(typeof passwordHash).toBe('string');
      expect(passwordHash).not.toBe(input.password);
      expect(await compare(input.password, passwordHash as string)).toBe(true);
      expect(Object.values(others)).not.toContain(input.password);
    });

    it('creates an active account with the user role and the consent time', async () => {
      const { service, storedFields } = setup();

      await service.createRegisteredUser(input);

      expect(storedFields()).toEqual({
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        passwordHash: expect.any(String),
        role: Role.User,
        status: UserStatus.Active,
        consentAcceptedAt: input.consentAcceptedAt,
      });
    });

    it('trims and lowercases the email before it checks and stores it', async () => {
      const { model, service, storedFields } = setup();

      await service.createRegisteredUser({
        ...input,
        email: '  Sara@Example.COM ',
      });

      expect(model.exists).toHaveBeenCalledWith({ email: 'sara@example.com' });
      expect(storedFields().email).toBe('sara@example.com');
    });

    it('returns the stored user', async () => {
      const { service, storedFields } = setup();

      const user = await service.createRegisteredUser(input);

      expect(user).toBe(storedFields());
    });

    it('rejects an email that is already registered and stores nothing', async () => {
      const { model, service } = setup({ _id: 'an-existing-user' });

      const attempt = service.createRegisteredUser(input);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(EMAIL_TAKEN_MESSAGE);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('lets the error of the unique index through, for the exception filter', async () => {
      const { model, service } = setup();
      const duplicateKey = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { email: 1 },
      });
      model.create.mockRejectedValueOnce(duplicateKey);

      await expect(service.createRegisteredUser(input)).rejects.toBe(
        duplicateKey,
      );
    });
  });

  describe('findEntityByEmailWithPasswordHash (ACC-04)', () => {
    it('finds the account by its trimmed, lowercased email', async () => {
      const { model, service } = setup();

      await service.findEntityByEmailWithPasswordHash('  Sara@Example.COM ');

      expect(model.findOne).toHaveBeenCalledWith({ email: 'sara@example.com' });
    });

    it('asks for the password hash, which the schema hides by default', async () => {
      const { select, service } = setup();

      await service.findEntityByEmailWithPasswordHash(input.email);

      expect(select).toHaveBeenCalledWith('+passwordHash');
    });

    it('returns the account, or null when there is none', async () => {
      const account = { email: input.email };

      expect(
        await setup(null, account).service.findEntityByEmailWithPasswordHash(
          input.email,
        ),
      ).toBe(account);
      expect(
        await setup(null, null).service.findEntityByEmailWithPasswordHash(
          input.email,
        ),
      ).toBeNull();
    });
  });

  describe('findEntityById (ACC-04)', () => {
    const id = '6740f1c2a4b5c6d7e8f90123';

    it('finds the account by id, without asking for the password hash', async () => {
      const account = { email: input.email };
      const { model, select, service } = setup(null, account);

      expect(await service.findEntityById(id)).toBe(account);
      expect(model.findById).toHaveBeenCalledWith(id);
      expect(select).not.toHaveBeenCalled();
    });

    it('returns null when there is no such account', async () => {
      const { service } = setup(null, null);

      expect(await service.findEntityById(id)).toBeNull();
    });

    it('returns null for an id that cannot be one, without asking the database', async () => {
      const { model, service } = setup();

      expect(await service.findEntityById('not-an-id')).toBeNull();
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('recordFailedLogin (ACC-05)', () => {
    it('adds one failed login with a single atomic increment', async () => {
      const { model, countSelect, service } = setupLockout({
        failedLoginAttempts: 1,
      });

      await service.recordFailedLogin(userObjectId, policy, now);

      expect(model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        userObjectId,
        { $inc: { failedLoginAttempts: 1 } },
        { returnDocument: 'after' },
      );
      expect(countSelect).toHaveBeenCalledWith('failedLoginAttempts');
    });

    it.each([1, 2, 3, 4])(
      'leaves the account open on failure number %i',
      async (count) => {
        const { model, service } = setupLockout({ failedLoginAttempts: count });

        expect(
          await service.recordFailedLogin(userObjectId, policy, now),
        ).toBeNull();
        expect(model.updateOne).not.toHaveBeenCalled();
      },
    );

    it('locks the account for 15 minutes on the 5th failure and returns the end of the lock', async () => {
      const { model, service } = setupLockout({ failedLoginAttempts: 5 });

      const lockedUntil = await service.recordFailedLogin(
        userObjectId,
        policy,
        now,
      );

      expect(lockedUntil).toEqual(new Date('2026-11-15T12:15:00.000Z'));
      expect(model.updateOne).toHaveBeenCalledTimes(1);
      expect(model.updateOne).toHaveBeenCalledWith(
        {
          _id: userObjectId,
          $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
        },
        { $set: { lockedUntil } },
      );
    });

    it('sets the lock only on an account that has none, so a late failure cannot push it back', async () => {
      const { model, service } = setupLockout({ failedLoginAttempts: 7 });

      await service.recordFailedLogin(userObjectId, policy, now);

      const [filter] = model.updateOne.mock.calls[0] as unknown as [
        { $or: object[] },
      ];
      expect(filter.$or).toEqual([
        { lockedUntil: null },
        { lockedUntil: { $lte: now } },
      ]);
    });

    it('still reports the lock for a failure over the limit, which arrived at the same time as the 5th', async () => {
      const { service } = setupLockout({ failedLoginAttempts: 6 });

      expect(
        await service.recordFailedLogin(userObjectId, policy, now),
      ).toEqual(new Date('2026-11-15T12:15:00.000Z'));
    });

    it('does nothing when the account is gone', async () => {
      const { model, service } = setupLockout(null);

      expect(
        await service.recordFailedLogin(userObjectId, policy, now),
      ).toBeNull();
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('clearExpiredLock (ACC-05)', () => {
    it('clears a lock that has ended, with the count that caused it', async () => {
      const { model, service } = setupLockout(null);

      await service.clearExpiredLock(userObjectId, now);

      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: userObjectId, lockedUntil: { $lte: now } },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } },
      );
    });
  });

  describe('resetFailedLogins (ACC-05)', () => {
    it('forgets the failed logins and the lock, and writes only when there is something to forget', async () => {
      const { model, service } = setupLockout(null);

      await service.resetFailedLogins(userObjectId);

      expect(model.updateOne).toHaveBeenCalledWith(
        {
          _id: userObjectId,
          $or: [
            { failedLoginAttempts: { $gt: 0 } },
            { lockedUntil: { $ne: null } },
          ],
        },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } },
      );
    });
  });
});
