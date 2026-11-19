# Hotel bookings module

Hotel reservations (`hotel_bookings`). The rooms and their nights belong to the hotels module, and this module reaches them only through `HotelRoomHoldsService` (see "Holding rooms for a reservation" in the hotels README).

## Reserve rooms and hold them for payment (HTL-16, HTL-18)

- `POST /api/hotel-bookings` is for registered users (role `user`) only. Guests get 401, administrators and moderators get 403.
- The body is the hotel, the dates, and the rooms with the guests of each: `adults` and `childAges` (each 0 to 17). Every room needs at least one guest, and the reservation needs at least one adult in total (HTL-16), so a room with only children is allowed. Each room can be chosen once, and a reservation has 1 to 20 rooms, the same limit as the search (HTL-11). Room ids are compared in lower case.
- The client never sends a price, status, owner, hold or reference. `forbidNonWhitelisted` answers 400 for them.
- The checks run in this order, cheapest first: the body (400), the stay (400: check-in not in the past, at most 366 nights, the same as search), the hotel is active (404), every room is a room of this hotel (404), no room has more guests than its maximum occupancy (400), every room is free for the whole stay (409, nothing is held). Then the rooms are held (409 if someone else got a night first).
- Going to payment is this call, so it is when the 10-minute hold of HTL-18 starts. The reservation is created as `pending_payment` with `holdExpiresAt` = now + 10 minutes, and every night of every room is held in `room_nights` with the same moment.
- All or nothing: the rooms are held first and the reservation is saved after. If saving the reservation fails, the nights it held are released. There is no transaction, because the CI database is a single MongoDB server; the unique (`roomId`, `date`) index of `room_nights` decides who gets a night, and the e2e test sends five requests for the same room at the same moment (one gets 201, four get 409).
- The total is the sum over the rooms of nights x the room's price at that moment, in whole minor units of the platform currency. Each booked room keeps its own price, a label (`101 (Double)`) and its guests, so later changes to the room do not change the reservation (HTL-05).
- The hotel's check-in and check-out times and its cancellation tiers are copied into the reservation for the confirmation (HTL-17) and the cancellation (HTL-21). A hotel that never set its policies can still be booked: the times are then `null` and the tiers empty, which means no refund. The tiers are stored and returned with the highest threshold first.
- `reference` stays empty until the payment succeeds, as HTL-17 says, so its unique index is `sparse`.

## Not in this module yet

- **Hold expiry (HTL-18, GEN-11).** Nothing moves an unpaid reservation to `expired` yet. Until the job exists, a reservation whose hold has ended stays `pending_payment` with a `holdExpiresAt` in the past. The rooms are free again anyway: every query of the hotels module ignores a held night whose `holdExpiresAt` has passed, and a new hold removes it before it takes the night. The job needs `@nestjs/schedule` and `ScheduleModule.forRoot()` in `AppModule`; flight seat holds (FLT-22) need the same, so it should be added once for both.
- **Confirmation after payment (HTL-17).** It must confirm only with an update that matches `status: pending_payment` **and** `holdExpiresAt > now`. After the hold ends, another reservation may already have taken the nights, so a late payment must be refunded instead of confirmed.
- **Policy acceptance (PAY-02).** The acceptance of the hotel's policies and the moment it happened (`policyAcceptedAt`) are added by PAY-02, before payment starts.
- **Reading and cancelling reservations (HTL-20 to HTL-22).** They add their own indexes and the ownership checks (ACC-11).
- **Room deletion.** HTL-06 deletes a room only if no `room_nights` document with a reservation was ever stored for it. Once expired holds are cleaned up, that check must also look at `hotel_bookings`.
