import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { EmailService } from './email.service';
import { mailTransportProvider } from './mail-transport';
import { Notification, NotificationSchema } from './models/notification.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    // GEN-01-B: the User model, read only, for the address and name of each
    // recipient. UsersModule does not import this module, so there is no cycle.
    UsersModule,
  ],
  controllers: [NotificationsController],
  // EmailService and its transport: GEN-01-B.
  providers: [NotificationsService, EmailService, mailTransportProvider],
  // Other modules send notifications through NotificationsService only;
  // the admin module sends the moderator invitation through EmailService.
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
