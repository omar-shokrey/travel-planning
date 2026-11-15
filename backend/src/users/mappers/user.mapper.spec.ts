import { Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { toUserResponse, type UserSource } from './user.mapper';

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
      createdAt: '2026-11-05T11:00:00.000Z',
    });
  });

  it('tells when the account must set a new password (ACC-07a, ACC-13)', () => {
    expect(
      toUserResponse({ ...source, mustChangePassword: true }),
    ).toMatchObject({ mustChangePassword: true });
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
      'id',
      'mustChangePassword',
      'name',
      'role',
      'status',
    ]);
  });
});
