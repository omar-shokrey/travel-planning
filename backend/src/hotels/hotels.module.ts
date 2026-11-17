import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceModule } from '../reference/reference.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { HotelsController } from './hotels.controller';
import { Hotel, HotelSchema } from './models/hotel.schema';
import { Room, RoomSchema } from './models/room.schema';
import { HotelsService } from './hotels.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
    ReferenceModule,
    UploadsModule,
    UsersModule,
  ],
  controllers: [HotelsController],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
