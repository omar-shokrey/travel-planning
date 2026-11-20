import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
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
  // or hotel exists (ACC-13), and to deactivate it (ACC-15). Neither imports
  // AdminModule.
  // GEN-10 (report handling): ReportsModule, BlogModule and ItinerariesModule
  // own the reports, posts, comments and itineraries, and UploadsModule
  // deletes the images of deleted content. None of them imports AdminModule.
  // AuditModule to record admin actions and read the audit log (GEN-07).
  imports: [
    AuditModule,
    AuthModule,
    BlogModule,
    // FlightBookingsModule and HotelBookingsModule to find the travellers
    // with a confirmed, not yet over booking of a deactivated airline or
    // hotel, who are notified (ACC-15). Neither imports AdminModule.
    FlightBookingsModule,
    FlightsModule,
    HotelBookingsModule,
    HotelsModule,
    ItinerariesModule,
    // NotificationsService: a suspended account (ACC-16, ACC-15) and the
    // moderators of a deactivated provider (ACC-15) are notified (GEN-01).
    NotificationsModule,
    ReportsModule,
    UploadsModule,
    UsersModule,
  ],
  controllers: [AdminController, AdminModerationController],
  providers: [AdminService, AdminModerationService],
})
export class AdminModule {}
