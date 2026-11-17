import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceModule } from '../reference/reference.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { HotelAvailableRoomsController } from './hotel-available-rooms.controller';
import { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { HotelDetailsController } from './hotel-details.controller';
import { HotelDetailsService } from './hotel-details.service';
import { HotelPoliciesController } from './hotel-policies.controller';
import { HotelPoliciesService } from './hotel-policies.service';
import { HotelRoomHoldsService } from './hotel-room-holds.service';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { HotelRoomStatusController } from './hotel-room-status.controller';
import { HotelRoomStatusService } from './hotel-room-status.service';
import { HotelRoomsController } from './hotel-rooms.controller';
import { HotelRoomsService } from './hotel-rooms.service';
import { HotelsController } from './hotels.controller';
import { Hotel, HotelSchema } from './models/hotel.schema';
import { RoomNight, RoomNightSchema } from './models/room-night.schema';
import { Room, RoomSchema } from './models/room.schema';
import { HotelsService } from './hotels.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
    ]),
    ReferenceModule,
    UploadsModule,
    UsersModule,
  ],
  // HotelDetailsController holds `GET /hotels/:id` and must stay last, so a
  // controller with a fixed path such as `GET /hotels/search` is matched first.
  controllers: [
    HotelsController,
    HotelPoliciesController,
    HotelRoomsController,
    HotelRoomStatusController,
    HotelAvailableRoomsController,
    HotelSearchController,
    HotelDetailsController,
  ],
  providers: [
    HotelsService,
    HotelDetailsService,
    HotelPoliciesService,
    HotelRoomsService,
    HotelRoomStatusService,
    HotelAvailableRoomsService,
    HotelSearchService,
    HotelRoomHoldsService,
  ],
  // HotelRoomHoldsService: the reservations of HTL-16 and HTL-18 find and
  // hold rooms only through it.
  exports: [HotelsService, HotelRoomHoldsService],
})
export class HotelsModule {}
