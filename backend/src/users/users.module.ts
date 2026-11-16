import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceModule } from '../reference/reference.module';
import { User, UserSchema } from './models/user.schema';
import { ProfileService } from './profile.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    // The countries list, read-only, for the supported currencies (ACC-09).
    ReferenceModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, ProfileService],
  exports: [MongooseModule, UsersService],
})
export class UsersModule {}
