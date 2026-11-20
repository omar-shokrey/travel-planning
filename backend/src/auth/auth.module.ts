import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { BlogModule } from '../blog/blog.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { UsersModule } from '../users/users.module';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AccountDeactivationService } from './account-deactivation.service';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthTokensService } from './auth-tokens.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Session, SessionSchema } from './models/session.schema';
import { SessionsService } from './sessions.service';

@Module({
  // The secret and the lifetime are passed on every call, so each token type
  // uses its own.
  imports: [
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    UsersModule,
    // ACC-12: deactivating your own account. None of these four modules
    // imports AuthModule (only AppModule and AdminModule do), so no cycle.
    // PostsService hides the posts of the account.
    BlogModule,
    // ItinerariesService hides its public itineraries.
    ItinerariesModule,
    // FlightBookingsService tells whether a flight booking blocks it.
    FlightBookingsModule,
    // HotelBookingsService tells whether a hotel reservation blocks it.
    HotelBookingsModule,
  ],
  controllers: [AuthController, AccountDeactivationController],
  providers: [
    AccountDeactivationService,
    AuthCookiesService,
    AuthService,
    AuthTokensService,
    SessionsService,
    // Global guards run in the order they are listed: first who is calling
    // (JwtAuthGuard), then whether that role may do it (RolesGuard).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // SessionsService is exported for AdminModule: an admin password reset
  // ends the sessions of the account (ACC-07a).
  exports: [AuthCookiesService, SessionsService],
})
export class AuthModule {}
