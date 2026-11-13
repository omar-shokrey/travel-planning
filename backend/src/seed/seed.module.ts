import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { databaseOptions } from '../config/database.config';
import { ReferenceModule } from '../reference/reference.module';
import { UsersModule } from '../users/users.module';
import { validateSeedEnv } from './seed.env';
import { SeedService } from './seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateSeedEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: databaseOptions,
    }),
    ReferenceModule,
    UsersModule,
  ],
  providers: [SeedService],
})
export class SeedModule {}
