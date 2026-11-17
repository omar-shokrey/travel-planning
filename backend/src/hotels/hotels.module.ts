import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceModule } from '../reference/reference.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { HotelDetailsController } from './hotel-details.controller';
import { HotelDetailsService } from './hotel-details.service';
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
  // HotelDetailsController holds `GET /hotels/:id` and must stay last, so a
  // controller with a fixed path such as `GET /hotels/search` is matched first.
  controllers: [HotelsController, HotelDetailsController],
  providers: [HotelsService, HotelDetailsService],
  exports: [HotelsService],
})
export class HotelsModule {}
