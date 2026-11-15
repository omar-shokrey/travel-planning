import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { RolesGuard } from '../common/guards/roles.guard';
import { UsersModule } from '../users/users.module';
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
  ],
  controllers: [AuthController],
  providers: [
    AuthCookiesService,
    AuthService,
    AuthTokensService,
    SessionsService,
    // Global guards run in the order they are listed: first who is calling
    // (JwtAuthGuard), then whether that role may do it (RolesGuard).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthCookiesService],
})
export class AuthModule {}
