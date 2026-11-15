import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Session } from './../../src/auth/models/session.schema';

/**
 * Deletes the sessions that the logins of one test user created, one by one
 * by id. A test that logs in calls it for each account it made, before it
 * deletes the account. Only the `-test` database is ever touched.
 */
export async function deleteSessionsOf(
  app: INestApplication,
  userId: string,
): Promise<void> {
  const sessions = app.get<Model<Session>>(getModelToken(Session.name));
  const found = await sessions.find({ userId }).select('_id').lean().exec();
  for (const { _id } of found) {
    await sessions.findByIdAndDelete(_id).exec();
  }
}
