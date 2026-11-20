import { Mongoose, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { User, UserSchema } from './user.schema';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const UserModel = mongoose.model(User.name, UserSchema);

const valid = {
  name: 'Omar Hossam',
  email: 'omar@example.com',
  passwordHash: 'a-bcrypt-hash',
};

const invalidFields = (data: Record<string, unknown>): Promise<string[]> =>
  new UserModel(data).validate().then(
    () => [],
    (error: { errors: Record<string, unknown> }) =>
      Object.keys(error.errors).sort(),
  );

describe('User model', () => {
  it('accepts a user with a name, an email and a password hash', async () => {
    expect(await invalidFields(valid)).toEqual([]);
  });

  it('starts as an active user with no failed logins', () => {
    const user = new UserModel(valid);

    expect(user.role).toBe(Role.User);
    expect(user.status).toBe(UserStatus.Active);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.mustChangePassword).toBe(false);
  });

  it('counts an account as verified unless it is saved with emailVerified false (ACC-02)', () => {
    expect(new UserModel(valid).emailVerified).toBe(true);
    expect(
      new UserModel({ ...valid, emailVerified: false }).emailVerified,
    ).toBe(false);
  });

  it('fills emailVerified true when a document without the field is read (ACC-02)', () => {
    const loaded = UserModel.hydrate({ _id: new Types.ObjectId(), ...valid });

    expect(loaded.emailVerified).toBe(true);
  });

  it('lowercases and trims the email', () => {
    const user = new UserModel({ ...valid, email: '  Omar@Example.COM ' });

    expect(user.email).toBe('omar@example.com');
  });

  it.each(['name', 'email', 'passwordHash'])('requires %s', async (field) => {
    expect(await invalidFields({ ...valid, [field]: undefined })).toContain(
      field,
    );
  });

  it('rejects a role or status that does not exist', async () => {
    expect(await invalidFields({ ...valid, role: 'guest' })).toEqual(['role']);
    expect(await invalidFields({ ...valid, status: 'banned' })).toEqual([
      'status',
    ]);
  });

  it('rejects a negative failed login count', async () => {
    expect(await invalidFields({ ...valid, failedLoginAttempts: -1 })).toEqual([
      'failedLoginAttempts',
    ]);
  });

  it('accepts a moderator assignment', async () => {
    const assignment = {
      providerType: 'airline',
      providerId: new Types.ObjectId(),
    };

    expect(
      await invalidFields({
        ...valid,
        role: Role.AirlineModerator,
        assignment,
      }),
    ).toEqual([]);
  });

  it('rejects an assignment with no provider or an unknown type', async () => {
    expect(
      await invalidFields({
        ...valid,
        assignment: { providerType: 'airport' },
      }),
    ).toEqual(['assignment.providerId', 'assignment.providerType']);
  });

  it('keeps the password hash out of normal queries', () => {
    expect(UserSchema.path('passwordHash').options.select).toBe(false);
  });

  it('declares a unique index on the email', () => {
    expect(UserSchema.indexes()).toContainEqual([
      { email: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
