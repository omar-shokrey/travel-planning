import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Session } from './../../src/auth/models/session.schema';
import { ACCESS_TOKEN_COOKIE } from './../../src/common/constants/cookies';
import { TEST_ACCESS_SECRET } from './auth-env';

const SESSION_MINUTES = 30;
const TOKEN_SECONDS = 300;

/**
 * For a test that makes its users straight in the database instead of logging
 * them in (ACC-06). A token alone no longer lets anyone in: the session it
 * names must exist and be live. This stores that session in the `-test`
 * database and returns the cookie a browser would send.
 *
 * The test deletes the session at the end with `deleteSessionsOf`.
 */
export async function sessionCookieFor(
  app: INestApplication,
  userId: string,
): Promise<string> {
  const sessions = app.get<Model<Session>>(getModelToken(Session.name));
  const now = new Date();
  const session = await sessions.create({
    userId,
    // The tests never refresh, so this only has to be present.
    refreshTokenHash: randomUUID(),
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MINUTES * 60 * 1000),
  });
  const token = await new JwtService().signAsync(
    { sub: userId, sid: session._id.toString() },
    { secret: TEST_ACCESS_SECRET, expiresIn: TOKEN_SECONDS },
  );
  return `${ACCESS_TOKEN_COOKIE}=${token}`;
}
