import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/models/flight-booking.schema';
import { FlightsModule } from '../flights/flights.module';
import { Airline, AirlineSchema } from '../flights/models/airline.schema';
import { Flight, FlightSchema } from '../flights/models/flight.schema';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/models/hotel-booking.schema';
import { HotelsModule } from '../hotels/hotels.module';
import { Hotel, HotelSchema } from '../hotels/models/hotel.schema';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { AdminBookingsService } from './admin-bookings.service';
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
    // ACC-17: the admin list of all bookings reads these collections, read
    // only, in one aggregation across flight_bookings and hotel_bookings
    // (AdminBookingsService). The booking modules own the writes and have no
    // merged list; FlightBookingsModule registers the Flight schema the same
    // way. The User model comes from UsersModule.
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: Hotel.name, schema: HotelSchema },
    ]),
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
  providers: [AdminService, AdminModerationService, AdminBookingsService],
})
export class AdminModule {}
