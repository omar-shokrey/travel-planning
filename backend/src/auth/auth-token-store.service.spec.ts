import { Types, type Model } from 'mongoose';
import { createHash } from 'node:crypto';
import {
  AUTH_TOKEN_BYTES,
  AuthTokenStoreService,
  hashAuthToken,
} from './auth-token-store.service';
import { AuthTokenType } from './enums/auth-token-type.enum';
import { AuthToken, AuthTokenSchema } from './models/auth-token.schema';

const USER_ID = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');
const NOW = new Date('2026-11-20T12:00:00.000Z');
const HOUR = 3_600_000;

const duplicateKey = () =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

function setup() {
  const upsertExec = jest.fn().mockResolvedValue(null);
  const consumed: { value: unknown } = { value: { userId: USER_ID } };
  interface DeleteChain {
    select: jest.Mock<DeleteChain, []>;
    lean: jest.Mock<DeleteChain, []>;
    exec: jest.Mock<Promise<unknown>, []>;
  }
  const deleteChain: DeleteChain = {
    select: jest.fn(() => deleteChain),
    lean: jest.fn(() => deleteChain),
    exec: jest.fn(() => Promise.resolve(consumed.value)),
  };
  const model = {
    findOneAndUpdate: jest.fn((..._args: unknown[]) => ({
      exec: upsertExec,
    })),
    findOneAndDelete: jest.fn((..._args: unknown[]) => deleteChain),
  };
  const store = new AuthTokenStoreService(model as unknown as Model<AuthToken>);
  return { store, model, upsertExec, deleteChain, consumed };
}

describe('auth_tokens schema (ACC-02, ACC-07)', () => {
  it('is stored in the auth_tokens collection with timestamps', () => {
    expect(AuthTokenSchema.get('collection')).toBe('auth_tokens');
    expect(AuthTokenSchema.get('timestamps')).toBe(true);
  });

  it('has a unique hash, one token per user and type, and a TTL on expiresAt, and no other index', () => {
    expect(AuthTokenSchema.indexes()).toEqual([
      [{ tokenHash: 1 }, { unique: true }],
      [{ userId: 1, type: 1 }, { unique: true }],
      [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
    ]);
  });

  it('accepts only the two token types', () => {
    expect(AuthTokenSchema.path('type').options).toMatchObject({
      type: String,
      enum: ['email_verification', 'password_reset'],
    });
  });
});

describe('hashAuthToken', () => {
  it('is the SHA-256 of the token in hex', () => {
    expect(hashAuthToken('abc')).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
    expect(hashAuthToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuthTokenStoreService.issue', () => {
  it('returns 32 random bytes in base64url, and a new token every time', async () => {
    const { store } = setup();

    const first = await store.issue(
      USER_ID,
      AuthTokenType.EmailVerification,
      HOUR,
      NOW,
    );
    const second = await store.issue(
      USER_ID,
      AuthTokenType.EmailVerification,
      HOUR,
      NOW,
    );

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(AUTH_TOKEN_BYTES);
    expect(second).not.toBe(first);
  });

  it("stores only the hash and the expiry, replacing the user's token of that type in one upsert", async () => {
    const { store, model } = setup();

    const token = await store.issue(
      USER_ID,
      AuthTokenType.PasswordReset,
      30 * 60_000,
      NOW,
    );

    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: USER_ID, type: AuthTokenType.PasswordReset },
      {
        $set: {
          tokenHash: hashAuthToken(token),
          expiresAt: new Date('2026-11-20T12:30:00.000Z'),
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    expect(JSON.stringify(model.findOneAndUpdate.mock.calls)).not.toContain(
      token,
    );
  });

  it('runs the upsert once more when a first token of the same user was inserted at the same moment', async () => {
    const { store, model, upsertExec } = setup();
    upsertExec.mockRejectedValueOnce(duplicateKey());

    await expect(
      store.issue(USER_ID, AuthTokenType.EmailVerification, HOUR, NOW),
    ).resolves.toEqual(expect.any(String));
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('passes on any other database error', async () => {
    const { store, model, upsertExec } = setup();
    const failure = new Error('database down');
    upsertExec.mockRejectedValueOnce(failure);

    await expect(
      store.issue(USER_ID, AuthTokenType.EmailVerification, HOUR, NOW),
    ).rejects.toBe(failure);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('AuthTokenStoreService.issueUnlessRecent', () => {
  it('replaces only a token older than the interval, in one upsert, and returns the new one', async () => {
    const { store, model } = setup();

    const token = await store.issueUnlessRecent(
      USER_ID,
      AuthTokenType.EmailVerification,
      24 * HOUR,
      60_000,
      NOW,
    );

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        type: AuthTokenType.EmailVerification,
        updatedAt: { $lte: new Date('2026-11-20T11:59:00.000Z') },
      },
      {
        $set: {
          tokenHash: hashAuthToken(token as string),
          expiresAt: new Date('2026-11-21T12:00:00.000Z'),
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  });

  it('returns null, without trying again, when a newer token makes the upsert hit the unique index', async () => {
    const { store, model, upsertExec } = setup();
    upsertExec.mockRejectedValueOnce(duplicateKey());

    await expect(
      store.issueUnlessRecent(
        USER_ID,
        AuthTokenType.EmailVerification,
        HOUR,
        60_000,
        NOW,
      ),
    ).resolves.toBeNull();
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('passes on any other database error', async () => {
    const { store, upsertExec } = setup();
    const failure = new Error('database down');
    upsertExec.mockRejectedValueOnce(failure);

    await expect(
      store.issueUnlessRecent(
        USER_ID,
        AuthTokenType.EmailVerification,
        HOUR,
        60_000,
        NOW,
      ),
    ).rejects.toBe(failure);
  });
});

describe('AuthTokenStoreService.consume', () => {
  it('deletes the token of that type, hash and an expiry after now in one step, and returns its user', async () => {
    const { store, model } = setup();

    await expect(
      store.consume('the-token', AuthTokenType.EmailVerification, NOW),
    ).resolves.toBe(USER_ID);
    expect(model.findOneAndDelete).toHaveBeenCalledWith({
      type: AuthTokenType.EmailVerification,
      tokenHash: hashAuthToken('the-token'),
      expiresAt: { $gt: NOW },
    });
  });

  it('returns null when nothing matches: unknown, expired, used, replaced or of another type', async () => {
    const { store, consumed } = setup();
    consumed.value = null;

    await expect(
      store.consume('the-token', AuthTokenType.PasswordReset, NOW),
    ).resolves.toBeNull();
  });

  it('looks the token up by its hash, never by the token itself', async () => {
    const { store, model } = setup();

    await store.consume('the-token', AuthTokenType.EmailVerification, NOW);

    expect(JSON.stringify(model.findOneAndDelete.mock.calls)).not.toContain(
      'the-token',
    );
  });
});
