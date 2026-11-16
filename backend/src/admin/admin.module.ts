import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  // AuthModule for SessionsService: a password reset ends the sessions of
  // the account (ACC-07a). AuthModule does not import AdminModule.
  // FlightsModule and HotelsModule to check that a new moderator's airline
  // or hotel exists (ACC-13). Neither imports AdminModule.
  // GEN-10 (report handling): ReportsModule, BlogModule and ItinerariesModule
  // own the reports, posts and itineraries, and UploadsModule deletes the
  // images of deleted content. None of them imports AdminModule.
  imports: [
    AuthModule,
    BlogModule,
    FlightsModule,
    HotelsModule,
    ItinerariesModule,
    // NotificationsService: a suspended user is notified (ACC-16, GEN-01).
    NotificationsModule,
    ReportsModule,
    UploadsModule,
    UsersModule,
  ],
  controllers: [AdminController, AdminModerationController],
  providers: [AdminService, AdminModerationService],
})
export class AdminModule {}
