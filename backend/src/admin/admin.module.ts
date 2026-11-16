import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  // AuthModule for SessionsService: a password reset ends the sessions of
  // the account (ACC-07a). AuthModule does not import AdminModule.
  // FlightsModule and HotelsModule to check that a new moderator's airline
  // or hotel exists (ACC-13). Neither imports AdminModule.
  imports: [AuthModule, FlightsModule, HotelsModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
