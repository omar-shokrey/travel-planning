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
import { ProviderType } from '../common/enums/provider-type.enum';

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

  describe('createModerator (ACC-13)', () => {
    const moderator = {
      name: 'Mona Hotel',
      email: ' Mona@Example.com ',
      password: 'Temp0rary1',
      role: Role.HotelModerator,
      providerType: ProviderType.Hotel,
      providerId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc'),
    } as const;

    it('stores an active moderator linked to its provider, who must change the password', async () => {
      const { service, storedFields } = setup();

      await service.createModerator(moderator);

      const { passwordHash, ...others } = storedFields();
      expect(others).toEqual({
        name: 'Mona Hotel',
        email: 'mona@example.com',
        role: Role.HotelModerator,
        status: UserStatus.Active,
        mustChangePassword: true,
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: moderator.providerId,
        },
      });
      expect(await compare('Temp0rary1', passwordHash as string)).toBe(true);
    });

    it('refuses an email that is already registered and stores nothing', async () => {
      const { model, service } = setup({ _id: 'someone' });

      const attempt = service.createModerator(moderator);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(EMAIL_TAKEN_MESSAGE);
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus (ACC-16)', () => {
    function setupStatus(updated: object | null) {
      const exec = jest.fn().mockResolvedValue(updated);
      const model = { findOneAndUpdate: jest.fn(() => ({ exec })) };
      const service = new UsersService(model as unknown as Model<User>);
      return { model, service };
    }

    it('moves the status only when it is still the expected one, in one update', async () => {
      const updated = { _id: userObjectId, status: UserStatus.Suspended };
      const { model, service } = setupStatus(updated);

      const result = await service.changeStatus(
        userObjectId,
        UserStatus.Active,
        UserStatus.Suspended,
      );

      expect(result).toBe(updated);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userObjectId, status: UserStatus.Active },
        { $set: { status: UserStatus.Suspended } },
        { returnDocument: 'after' },
      );
    });

    it('returns null when the status was already different, and changes nothing', async () => {
      const { service } = setupStatus(null);

      expect(
        await service.changeStatus(
          userObjectId,
          UserStatus.Suspended,
          UserStatus.Active,
        ),
      ).toBeNull();
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

  describe('updateProfile (ACC-09)', () => {
    function setupProfile(updated: object | null = { _id: userObjectId }) {
      const exec = jest.fn().mockResolvedValue(updated);
      const model = {
        findByIdAndUpdate: jest.fn(() => ({ exec })),
        findById: jest.fn(() => ({ exec })),
      };
      const service = new UsersService(model as unknown as Model<User>);
      const update = () =>
        (model.findByIdAndUpdate.mock.calls[0] as unknown[])[1] as Record<
          string,
          Record<string, unknown>
        >;
      return { model, service, update };
    }

    it('sets the fields that were given, in one update, and returns the account', async () => {
      const updated = { _id: userObjectId, name: 'Sara A.' };
      const { model, service, update } = setupProfile(updated);

      const result = await service.updateProfile(userObjectId.toString(), {
        name: 'Sara A.',
        phone: '+20 10 1234 5678',
        preferredCurrency: 'EGP',
      });

      expect(result).toBe(updated);
      expect(model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        userObjectId.toString(),
        expect.anything(),
        { returnDocument: 'after', runValidators: true },
      );
      expect(update()).toEqual({
        $set: {
          name: 'Sara A.',
          phone: '+20 10 1234 5678',
          preferredCurrency: 'EGP',
        },
      });
    });

    it('removes the phone or the currency given as null, and leaves out the others', async () => {
      const { service, update } = setupProfile();

      await service.updateProfile(userObjectId.toString(), {
        phone: null,
        preferredCurrency: null,
      });

      expect(update()).toEqual({ $unset: { phone: 1, preferredCurrency: 1 } });
    });

    it('only reads the account when nothing is to change', async () => {
      const found = { _id: userObjectId };
      const { model, service } = setupProfile(found);

      expect(await service.updateProfile(userObjectId.toString(), {})).toBe(
        found,
      );
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(model.findById).toHaveBeenCalledWith(userObjectId.toString());
    });

    it('returns null for an id that cannot be one, without asking the database', async () => {
      const { model, service } = setupProfile();

      expect(await service.updateProfile('nope', { name: 'Sara' })).toBeNull();
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
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

  describe('findEntityByIdWithPasswordHash (ACC-08)', () => {
    function setupById(found: object | null) {
      const exec = jest.fn().mockResolvedValue(found);
      const select = jest.fn(() => ({ exec }));
      const model = { findById: jest.fn(() => ({ select })) };
      const service = new UsersService(model as unknown as Model<User>);
      return { model, select, service };
    }

    it('finds the account by id and asks for the password hash', async () => {
      const found = { _id: userObjectId, passwordHash: 'a-bcrypt-hash' };
      const { model, select, service } = setupById(found);

      const user = await service.findEntityByIdWithPasswordHash(
        userObjectId.toString(),
      );

      expect(model.findById).toHaveBeenCalledWith(userObjectId.toString());
      expect(select).toHaveBeenCalledWith('+passwordHash');
      expect(user).toBe(found);
    });

    it('returns null for an id that cannot be one, without asking the database', async () => {
      const { model, service } = setupById(null);

      expect(await service.findEntityByIdWithPasswordHash('nope')).toBeNull();
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('updatePassword (ACC-08)', () => {
    function setupUpdate(updated: object | null) {
      const exec = jest.fn().mockResolvedValue(updated);
      const model = { findByIdAndUpdate: jest.fn(() => ({ exec })) };
      const service = new UsersService(model as unknown as Model<User>);
      const update = (): { $set: Record<string, unknown> } =>
        (model.findByIdAndUpdate.mock.calls[0] as unknown[])[1] as {
          $set: Record<string, unknown>;
        };
      return { model, service, update };
    }

    it('stores a bcrypt hash of the new password and never the plain one', async () => {
      const { service, update } = setupUpdate({ _id: userObjectId });

      await service.updatePassword(userObjectId, 'N3wPassword');

      const { passwordHash } = update().$set;
      expect(passwordHash).not.toBe('N3wPassword');
      expect(await compare('N3wPassword', passwordHash as string)).toBe(true);
    });

    it('clears the flag that asks for a new password at the next login', async () => {
      const { model, service, update } = setupUpdate({ _id: userObjectId });

      await service.updatePassword(userObjectId, 'N3wPassword');

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        userObjectId,
        expect.anything(),
        { returnDocument: 'after' },
      );
      expect(update().$set.mustChangePassword).toBe(false);
      expect(Object.keys(update().$set).sort()).toEqual([
        'mustChangePassword',
        'passwordHash',
      ]);
    });

    it('returns the updated account, or null when it is gone', async () => {
      const updated = { _id: userObjectId, mustChangePassword: false };

      expect(
        await setupUpdate(updated).service.updatePassword(
          userObjectId,
          'N3wPassword',
        ),
      ).toBe(updated);
      expect(
        await setupUpdate(null).service.updatePassword(
          userObjectId,
          'N3wPassword',
        ),
      ).toBeNull();
    });
  });

  describe('setTemporaryPassword (ACC-07a)', () => {
    function setupReset(updated: object | null) {
      const exec = jest.fn().mockResolvedValue(updated);
      const model = { findByIdAndUpdate: jest.fn(() => ({ exec })) };
      const service = new UsersService(model as unknown as Model<User>);
      const update = () =>
        (model.findByIdAndUpdate.mock.calls[0] as unknown[])[1] as {
          $set: Record<string, unknown>;
          $unset: Record<string, unknown>;
        };
      return { model, service, update };
    }

    it('stores a bcrypt hash of the temporary password and never the plain one', async () => {
      const { service, update } = setupReset({ _id: userObjectId });

      await service.setTemporaryPassword(userObjectId, 'Temp0rary1');

      const { passwordHash } = update().$set;
      expect(passwordHash).not.toBe('Temp0rary1');
      expect(await compare('Temp0rary1', passwordHash as string)).toBe(true);
    });

    it('asks for a new password at the next login and clears the lockout', async () => {
      const { model, service, update } = setupReset({ _id: userObjectId });

      await service.setTemporaryPassword(userObjectId, 'Temp0rary1');

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        userObjectId,
        expect.anything(),
        { returnDocument: 'after' },
      );
      expect(update().$set).toMatchObject({
        mustChangePassword: true,
        failedLoginAttempts: 0,
      });
      expect(update().$unset).toEqual({ lockedUntil: 1 });
    });

    it('returns the updated account, or null when it is gone', async () => {
      const updated = { _id: userObjectId, mustChangePassword: true };

      expect(
        await setupReset(updated).service.setTemporaryPassword(
          userObjectId,
          'Temp0rary1',
        ),
      ).toBe(updated);
      expect(
        await setupReset(null).service.setTemporaryPassword(
          userObjectId,
          'Temp0rary1',
        ),
      ).toBeNull();
    });
  });

  describe('listAccounts (ACC-14)', () => {
    function setupList(found: object[] = [], total = 0) {
      const exec = jest.fn().mockResolvedValue(found);
      const limit = jest.fn(() => ({ exec }));
      const skip = jest.fn(() => ({ limit }));
      const sort = jest.fn(() => ({ skip }));
      const countExec = jest.fn().mockResolvedValue(total);
      const model = {
        find: jest.fn(() => ({ sort })),
        countDocuments: jest.fn(() => ({ exec: countExec })),
      };
      const service = new UsersService(model as unknown as Model<User>);
      const filter = (): Record<string, unknown> =>
        (model.find.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      return { model, sort, skip, limit, service, filter };
    }

    const page = { skip: 20, limit: 10 };

    /** The name condition of the search, as the RegExp MongoDB would apply. */
    const asRegExp = (filter: Record<string, unknown>): RegExp => {
      const [byName] = (
        filter as { $or: { name: { $regex: string; $options: string } }[] }
      ).$or;
      return new RegExp(byName.name.$regex, byName.name.$options);
    };

    it('returns one page of accounts, newest first, and the total that matches', async () => {
      const found = [{ _id: userObjectId }];
      const { sort, skip, limit, service } = setupList(found, 21);

      const result = await service.listAccounts({}, page);

      expect(result).toEqual({ items: found, total: 21 });
      expect(sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(skip).toHaveBeenCalledWith(20);
      expect(limit).toHaveBeenCalledWith(10);
    });

    it('lists every account when there is no search and no filter', async () => {
      const { model, service, filter } = setupList();

      await service.listAccounts({}, page);

      expect(filter()).toEqual({});
      expect(model.countDocuments).toHaveBeenCalledWith({});
    });

    it('filters by role and by status', async () => {
      const { service, filter } = setupList();

      await service.listAccounts(
        { role: Role.AirlineModerator, status: UserStatus.Suspended },
        page,
      );

      expect(filter()).toEqual({
        role: Role.AirlineModerator,
        status: UserStatus.Suspended,
      });
    });

    it('searches the name or the email, ignoring letter case', async () => {
      const { model, service, filter } = setupList();

      await service.listAccounts({ search: 'Sara' }, page);

      expect(filter()).toEqual({
        $or: [
          { name: { $regex: 'Sara', $options: 'i' } },
          { email: { $regex: 'Sara', $options: 'i' } },
        ],
      });
      const pattern = asRegExp(filter());
      expect(pattern.test('Sara Ahmed')).toBe(true);
      expect(pattern.test('my friend sara')).toBe(true);
      expect(pattern.test('sara@example.com')).toBe(true);
      expect(pattern.test('Omar')).toBe(false);
      expect(model.countDocuments).toHaveBeenCalledWith(filter());
    });

    it('treats the search as plain text, not as a pattern', async () => {
      const { service, filter } = setupList();

      await service.listAccounts({ search: 'a.b+(c)' }, page);

      const pattern = asRegExp(filter());
      expect(pattern.test('xa.b+(c)y')).toBe(true);
      expect(pattern.test('axbbc')).toBe(false);
    });
  });

  describe('findModeratorIdsOfProvider (ACC-15)', () => {
    const providerId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');

    function setupModerators(found: { _id: Types.ObjectId }[]) {
      const exec = jest.fn().mockResolvedValue(found);
      const lean = jest.fn(() => ({ exec }));
      const select = jest.fn(() => ({ lean }));
      const model = { find: jest.fn(() => ({ select })) };
      const service = new UsersService(model as unknown as Model<User>);
      return { model, select, service };
    }

    it('finds the moderators of one provider that have not closed their account', async () => {
      const { model, select, service } = setupModerators([
        { _id: userObjectId },
      ]);

      const ids = await service.findModeratorIdsOfProvider(
        ProviderType.Hotel,
        providerId,
      );

      expect(ids).toEqual([userObjectId]);
      expect(model.find).toHaveBeenCalledWith({
        'assignment.providerId': providerId,
        'assignment.providerType': ProviderType.Hotel,
        status: { $ne: UserStatus.Deactivated },
      });
      expect(select).toHaveBeenCalledWith('_id');
    });

    it('returns an empty list when the provider has no moderator', async () => {
      const { service } = setupModerators([]);

      expect(
        await service.findModeratorIdsOfProvider(
          ProviderType.Airline,
          providerId,
        ),
      ).toEqual([]);
    });
  });
});
