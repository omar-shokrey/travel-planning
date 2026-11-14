import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthCookiesService, AuthService],
  exports: [AuthCookiesService],
})
export class AuthModule {}
