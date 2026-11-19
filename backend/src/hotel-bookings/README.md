# Hotel bookings module

Hotel reservations (`hotel_bookings`). The rooms and their nights belong to the hotels module, and this module reaches them only through `HotelRoomHoldsService` (see "Holding rooms for a reservation" in the hotels README).

## Reserve rooms and hold them for payment (HTL-16, HTL-18)

- `POST /api/hotel-bookings` is for registered users (role `user`) only. Guests get 401, administrators and moderators get 403.
- The body is the hotel, the dates, and the rooms with the guests of each: `adults` and `childAges` (each 0 to 17). Every room needs at least one guest, and the reservation needs at least one adult in total (HTL-16), so a room with only children is allowed. Each room can be chosen once, and a reservation has 1 to 20 rooms, the same limit as the search (HTL-11). Room ids are compared in lower case.
- The client never sends a price, status, owner, hold or reference. `forbidNonWhitelisted` answers 400 for them.
- The checks run in this order, cheapest first: the body (400), the stay (400: check-in not in the past, at most 366 nights, the same as search), the hotel is active (404), every room is a room of this hotel (404), no room has more guests than its maximum occupancy (400), every room is free for the whole stay (409, nothing is held). Then the rooms are held (409 if someone else got a night first).
- Going to payment is this call, so it is when the 10-minute hold of HTL-18 starts. A room is refused (409, nothing held) when any night of the stay is booked by a Confirmed reservation, held by a hold that has not ended, or blocked by the moderator; the check-out day is not a night of the stay, so back-to-back stays are allowed. The reservation is created as `pending_payment` with `holdExpiresAt` = now + 10 minutes, and every night of every room is held in `room_nights` with the same moment.
- All or nothing: the rooms are held first and the reservation is saved after. If saving the reservation fails, the nights it held are released. There is no transaction, because the CI database is a single MongoDB server; the unique (`roomId`, `date`) index of `room_nights` decides who gets a night, and the e2e test sends five requests for the same room at the same moment (one gets 201, four get 409).
- The total is the sum over the rooms of nights x the room's price at that moment, in whole minor units of the platform currency. Each booked room keeps its own price, a label (`101 (Double)`) and its guests, so later changes to the room do not change the reservation (HTL-05).
- The hotel's check-in and check-out times and its cancellation tiers are copied into the reservation for the confirmation (HTL-17) and the cancellation (HTL-21). A hotel that never set its policies can still be booked: the times are then `null` and the tiers empty, which means no refund. The tiers are stored and returned with the highest threshold first.
- `reference` stays empty until the payment succeeds, as HTL-17 says, so its unique index is `sparse`.

## Hold expiry (HTL-18, GEN-11)

If the payment does not succeed within the 10 minutes, the reservation becomes `expired` and its rooms are released (GEN-11: Pending Payment -> Expired).

- **A job, every minute.** `HotelBookingExpiryService.expireDueHoldsJob` runs with `@Cron(EVERY_MINUTE)`, through the `ScheduleModule.forRoot()` that `AppModule` already registers for flights (FLT-22). It reads the `pending_payment` reservations whose `holdExpiresAt` is at or before now, oldest first, at most `HOTEL_BOOKING_EXPIRY_BATCH_SIZE` (100) per run, with the (`status`, `holdExpiresAt`) index of the spec. A larger backlog is cleared in a few runs.
- **Expire first, then release.** For each reservation, an update that matches only `{ _id, status: pending_payment, holdExpiresAt <= now }` sets `expired`. Only when it matched does the job call `HotelRoomHoldsService.release(bookingId)`, which deletes the `held` nights of that reservation and never touches booked or blocked nights. So a reservation confirmed in between (HTL-17) is never released, and one that two runs see at the same moment is released once. The webhook of HTL-17 must confirm with the mirror condition (`holdExpiresAt > now`), so a reservation can never be both confirmed and released.
- **Never a crash.** One failing reservation is logged and the others go on; the cron method catches every error. A release that fails after the status changed is logged: the nights keep their `holdExpiresAt`, which has passed, so every query of the hotels module already ignores them, and the next hold of those nights removes them.
- **Between the end of the hold and the next run** (at most one minute) the reservation still reads `pending_payment`, but its rooms are already free: the hotels module ignores a held night whose `holdExpiresAt` has passed. An expired reservation is never revived; a user who still wants the rooms makes a new reservation.
- **Tests:** `hotel-booking-expiry.service.spec.ts` (the exact query, sort, limit, update and release; a reservation confirmed in between; two runs at once; a failed update and a failed release; the cron metadata and the job's error handling) and the "expiry of unpaid holds" block of `test/hotel-bookings.e2e-spec.ts` (a two-room reservation expires and both rooms are booked again by someone else, a second run changes nothing, a confirmed reservation keeps its booked nights, a hold that has not ended is untouched, the job method itself).

## Not in this module yet

- **Confirmation after payment (HTL-17).** It must confirm only with an update that matches `status: pending_payment` **and** `holdExpiresAt > now`. After the hold ends, another reservation may already have taken the nights, so a late payment must be refunded instead of confirmed.
- **Policy acceptance (PAY-02)** is done in the payments module (`GET /api/bookings/hotel/:id/policies` and `POST .../accept-policies`): it shows the copied times and tiers and stores `policyAcceptedAt` through `HotelBookingsService.findOwnedEntityOrThrow` and `acceptPolicies`, which this module exports.
- **Reading and cancelling reservations (HTL-20 to HTL-22).** They add their own indexes and the ownership checks (ACC-11).
