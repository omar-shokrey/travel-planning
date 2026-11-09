import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MongooseModuleOptions } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

export const databaseOptions = (
  config: ConfigService,
): MongooseModuleOptions => ({
  uri: config.getOrThrow<string>('MONGODB_URI'),
  serverSelectionTimeoutMS: 10_000,
  retryAttempts: 2,
  retryDelay: 2_000,
  connectionFactory: (connection: Connection) => {
    const logger = new Logger('MongoDB');
    logger.log(`Connected to database "${connection.name}"`);
    connection.on('disconnected', () =>
      logger.warn('Disconnected from the database'),
    );
    return connection;
  },
});
