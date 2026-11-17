import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  // AuthModule for SessionsService: a password reset ends the sessions of
  // the account (ACC-07a). AuthModule does not import AdminModule.
  // FlightsModule and HotelsModule to check that a new moderator's airline
  // or hotel exists (ACC-13), and to deactivate it (ACC-15). Neither imports
  // AdminModule.
  imports: [
    AuthModule,
    FlightsModule,
    HotelsModule,
    // NotificationsService: a suspended account (ACC-16, ACC-15) and the
    // moderators of a deactivated provider (ACC-15) are notified (GEN-01).
    NotificationsModule,
    UsersModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
