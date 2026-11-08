import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BlogModule } from './blog/blog.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { FlightBookingsModule } from './flight-bookings/flight-bookings.module';
import { FlightsModule } from './flights/flights.module';
import { HotelBookingsModule } from './hotel-bookings/hotel-bookings.module';
import { HotelsModule } from './hotels/hotels.module';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { ReferenceModule } from './reference/reference.module';
import { ReportsModule } from './reports/reports.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
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
      }),
    }),
    AdminModule,
    AuditModule,
    AuthModule,
    BlogModule,
    ExchangeRatesModule,
    FlightBookingsModule,
    FlightsModule,
    HotelBookingsModule,
    HotelsModule,
    ItinerariesModule,
    NotificationsModule,
    PaymentsModule,
    ReferenceModule,
    ReportsModule,
    UploadsModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
