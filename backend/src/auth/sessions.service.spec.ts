import type { ConfigService } from '@nestjs/config';
import { Types, type Model } from 'mongoose';
import type { Session } from './models/session.schema';
import { SessionsService } from './sessions.service';

const MINUTE = 60_000;
const now = new Date('2026-11-15T12:00:00.000Z');
const inThirtyMinutes = new Date(now.getTime() + 30 * MINUTE);

const SESSION_ID = '6740f1c2a4b5c6d7e8f90abc';
const USER_ID = '6740f1c2a4b5c6d7e8f90123';

/**
 * A session model that records what the service sends it. `matched` is how
 * many documents the filter matched: 1 when a live session was found.
 */
function setup(matched = 1, minutes = 30) {
  const exec = jest.fn().mockResolvedValue({ matchedCount: matched });
  const model = {
    create: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn(() => ({ exec })),
    updateMany: jest.fn(() => ({ exec })),
  };
  const config = {
    getOrThrow: jest.fn((name: string) => {
      if (name !== 'SESSION_INACTIVITY_MINUTES') {
        throw new Error(`${name} is not set`);
      }
      return minutes;
    }),
  };
  const service = new SessionsService(
    model as unknown as Model<Session>,
    config as unknown as ConfigService,
  );
  /** The filter and the update of the one `updateOne` call. */
  const update = () => {
    const [filter, change] = model.updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    return { filter, set: change.$set };
  };

  return { model, service, update };
}

describe('SessionsService', () => {
  describe('create', () => {
    it('stores the session with the id the tokens carry and the end of the idle limit', async () => {
      const { model, service } = setup();
      const id = new Types.ObjectId(SESSION_ID);
      const userId = new Types.ObjectId(USER_ID);

      await service.create({ id, userId, refreshTokenHash: 'a-hash', now });

      expect(model.create).toHaveBeenCalledWith({
        _id: id,
        userId,
        refreshTokenHash: 'a-hash',
        lastActivityAt: now,
        expiresAt: inThirtyMinutes,
      });
    });

    it('uses SESSION_INACTIVITY_MINUTES for the end', async () => {
      const { model, service } = setup(1, 45);

      await service.create({
        id: new Types.ObjectId(SESSION_ID),
        userId: new Types.ObjectId(USER_ID),
        refreshTokenHash: 'a-hash',
        now,
      });

      const stored = (
        model.create.mock.calls[0] as unknown as [{ expiresAt: Date }]
      )[0];
      expect(stored.expiresAt).toEqual(new Date(now.getTime() + 45 * MINUTE));
    });

    it('stores no token, only the hash it was given', async () => {
      const { model, service } = setup();

      await service.create({
        id: new Types.ObjectId(SESSION_ID),
        userId: new Types.ObjectId(USER_ID),
        refreshTokenHash: 'a-hash',
        now,
      });

      expect(
        Object.keys(model.create.mock.calls[0][0] as object).sort(),
      ).toEqual([
        '_id',
        'expiresAt',
        'lastActivityAt',
        'refreshTokenHash',
        'userId',
      ]);
    });
  });

  describe('touch', () => {
    it('moves the end of a live session to the idle limit from now, and answers true', async () => {
      const { service, update } = setup();

      await expect(service.touch(SESSION_ID, USER_ID, now)).resolves.toBe(true);

      expect(update().set).toEqual({
        lastActivityAt: now,
        expiresAt: inThirtyMinutes,
      });
    });

    it('asks for a session of this user that is not revoked and has not run out', async () => {
      const { service, update } = setup();

      await service.touch(SESSION_ID, USER_ID, now);

      expect(update().filter).toEqual({
        _id: SESSION_ID,
        userId: USER_ID,
        revokedAt: null,
        expiresAt: { $gt: now },
      });
    });

    it('answers false when no live session matches', async () => {
      const { service } = setup(0);

      await expect(service.touch(SESSION_ID, USER_ID, now)).resolves.toBe(
        false,
      );
    });

    it('does it in one update, so a request cannot be counted between a check and a write', async () => {
      const { model, service } = setup();

      await service.touch(SESSION_ID, USER_ID, now);

      expect(model.updateOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('rotate', () => {
    const rotation = {
      sessionId: SESSION_ID,
      userId: USER_ID,
      currentHash: 'the-old-hash',
      newHash: 'the-new-hash',
      now,
    };

    it('replaces the hash and counts the refresh as activity, and answers true', async () => {
      const { service, update } = setup();

      await expect(service.rotate(rotation)).resolves.toBe(true);

      expect(update().set).toEqual({
        refreshTokenHash: 'the-new-hash',
        lastActivityAt: now,
        expiresAt: inThirtyMinutes,
      });
    });

    it('matches only a live session that holds the old hash', async () => {
      const { service, update } = setup();

      await service.rotate(rotation);

      expect(update().filter).toEqual({
        _id: SESSION_ID,
        userId: USER_ID,
        revokedAt: null,
        expiresAt: { $gt: now },
        refreshTokenHash: 'the-old-hash',
      });
    });

    it('answers false when the old hash is not the one stored, the session is revoked or it has run out', async () => {
      const { service } = setup(0);

      await expect(service.rotate(rotation)).resolves.toBe(false);
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on a session of this user that is not revoked yet', async () => {
      const { service, update } = setup();

      await service.revoke(SESSION_ID, USER_ID, now);

      expect(update().filter).toEqual({
        _id: SESSION_ID,
        userId: USER_ID,
        revokedAt: null,
      });
      expect(update().set).toEqual({ revokedAt: now });
    });

    it('does not fail when nothing matches, so logging out twice is harmless', async () => {
      const { service } = setup(0);

      await expect(
        service.revoke(SESSION_ID, USER_ID, now),
      ).resolves.toBeUndefined();
    });
  });

  describe('revokeAllOfUser (ACC-08, ACC-07a)', () => {
    const OTHER_SESSION_ID = '6740f1c2a4b5c6d7e8f90def';

    /** The filter and the change of the one `updateMany` call. */
    const updateManyCall = (model: { updateMany: jest.Mock }) =>
      model.updateMany.mock.calls[0] as unknown as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];

    it('revokes every live session of that one user, in one update', async () => {
      const { model, service } = setup();

      await service.revokeAllOfUser(USER_ID, now);

      expect(model.updateMany).toHaveBeenCalledTimes(1);
      const [filter, change] = updateManyCall(model);
      expect(filter).toEqual({ userId: USER_ID, revokedAt: null });
      expect(change).toEqual({ $set: { revokedAt: now } });
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('keeps the session it is told to keep', async () => {
      const { model, service } = setup();

      await service.revokeAllOfUser(USER_ID, now, OTHER_SESSION_ID);

      const [filter, change] = updateManyCall(model);
      expect(filter).toEqual({
        userId: USER_ID,
        revokedAt: null,
        _id: { $ne: OTHER_SESSION_ID },
      });
      expect(change).toEqual({ $set: { revokedAt: now } });
    });

    it('always names the user, so it never touches the sessions of anyone else', async () => {
      const { model, service } = setup();

      await service.revokeAllOfUser(USER_ID, now);
      await service.revokeAllOfUser(USER_ID, now, OTHER_SESSION_ID);

      for (const [filter] of model.updateMany.mock.calls as unknown as [
        Record<string, unknown>,
      ][]) {
        expect(filter.userId).toBe(USER_ID);
      }
    });

    it('does not fail when the user has no live session', async () => {
      const { service } = setup(0);

      await expect(
        service.revokeAllOfUser(USER_ID, now),
      ).resolves.toBeUndefined();
    });
  });

  it('fails with a clear message, and writes nothing, when SESSION_INACTIVITY_MINUTES is missing', async () => {
    const model = { updateOne: jest.fn() };
    const config = {
      getOrThrow: jest.fn(() => {
        throw new Error('SESSION_INACTIVITY_MINUTES is not set');
      }),
    };
    const service = new SessionsService(
      model as unknown as Model<Session>,
      config as unknown as ConfigService,
    );

    await expect(service.touch(SESSION_ID, USER_ID, now)).rejects.toThrow(
      'SESSION_INACTIVITY_MINUTES is not set',
    );
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});
