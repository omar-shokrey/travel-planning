import { MODULE_METADATA } from '@nestjs/common/constants';
import { UsersModule } from '../users/users.module';
import { EmailService } from './email.service';
import { mailTransportProvider } from './mail-transport';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

describe('NotificationsModule', () => {
  it('provides the email service and its transport (GEN-01-B) with the notifications', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, NotificationsModule),
    ).toEqual([NotificationsService, EmailService, mailTransportProvider]);
  });

  it('reads the users through UsersModule, for the address and name of each recipient', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, NotificationsModule),
    ).toContain(UsersModule);
  });

  it('exports NotificationsService, and EmailService for the moderator invitation', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, NotificationsModule),
    ).toEqual([NotificationsService, EmailService]);
  });
});
