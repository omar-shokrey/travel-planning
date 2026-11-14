import { ConflictException } from '@nestjs/common';
import { compare } from 'bcrypt';
import type { Model } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { User } from './models/user.schema';
import {
  EMAIL_TAKEN_MESSAGE,
  UsersService,
  type CreateUserInput,
} from './users.service';

const input: CreateUserInput = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Passw0rdOK',
  consentAcceptedAt: new Date('2026-11-14T10:00:00.000Z'),
};

/** What the service hands to the model. */
type StoredFields = Record<string, unknown>;

function setup(existing: { _id: string } | null = null) {
  const model = {
    exists: jest.fn().mockResolvedValue(existing),
    // Answers with what it was given, as a saved document would.
    create: jest.fn((fields: StoredFields) => Promise.resolve(fields)),
  };
  const service = new UsersService(model as unknown as Model<User>);
  const storedFields = (): StoredFields => model.create.mock.calls[0][0];

  return { model, service, storedFields };
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
});
