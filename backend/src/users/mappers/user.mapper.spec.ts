import { Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { toUserResponse, type UserSource } from './user.mapper';
import { ProviderType } from '../../common/enums/provider-type.enum';

const source: UserSource = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  role: Role.User,
  status: UserStatus.Active,
  mustChangePassword: false,
  createdAt: new Date('2026-11-05T13:00:00.000+02:00'),
};

describe('toUserResponse', () => {
  it('returns the public fields, with a string id and a UTC date', () => {
    expect(toUserResponse(source)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90123',
      name: 'Sara Ahmed',
      email: 'sara@example.com',
      role: 'user',
      status: 'active',
      mustChangePassword: false,
      emailVerified: true,
      createdAt: '2026-11-05T11:00:00.000Z',
    });
  });

  it.each([
    ['false while it is not verified', false, false],
    ['true once it is verified', true, true],
    ['true for an account saved before the field existed', undefined, true],
  ])(
    'tells whether the email is verified (ACC-02): %s',
    (_label, emailVerified, expected) => {
      expect(toUserResponse({ ...source, emailVerified }).emailVerified).toBe(
        expected,
      );
    },
  );

  it('tells when the account must set a new password (ACC-07a, ACC-13)', () => {
    expect(
      toUserResponse({ ...source, mustChangePassword: true }),
    ).toMatchObject({ mustChangePassword: true });
  });

  it('adds the phone and the preferred currency when the account has them (ACC-09)', () => {
    expect(
      toUserResponse({
        ...source,
        phone: '+20 10 1234 5678',
        preferredCurrency: 'EGP',
      }),
    ).toMatchObject({ phone: '+20 10 1234 5678', preferredCurrency: 'EGP' });
  });

  it('leaves out the phone and the preferred currency when the account has none', () => {
    const response = toUserResponse(source);

    expect(response).not.toHaveProperty('phone');
    expect(response).not.toHaveProperty('preferredCurrency');
  });

  it('adds the assignment of a moderator, with a string provider id (ACC-13)', () => {
    const providerId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');

    expect(
      toUserResponse({
        ...source,
        role: Role.AirlineModerator,
        assignment: { providerType: ProviderType.Airline, providerId },
      }),
    ).toMatchObject({
      assignment: {
        providerType: 'airline',
        providerId: '6740f1c2a4b5c6d7e8f90abc',
      },
    });
  });

  it('leaves out the assignment of an account that has none', () => {
    expect(toUserResponse(source)).not.toHaveProperty('assignment');
  });

  it('leaves out the password hash and every other private field', () => {
    const stored = {
      ...source,
      passwordHash: 'a-bcrypt-hash',
      failedLoginAttempts: 3,
      lockedUntil: new Date(),
      consentAcceptedAt: new Date(),
      updatedAt: new Date(),
    };

    expect(Object.keys(toUserResponse(stored)).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerified',
      'id',
      'mustChangePassword',
      'name',
      'role',
      'status',
    ]);
  });
});
