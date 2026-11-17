# Hotel bookings module

Hotel reservations (`hotel_bookings`). The rooms and their nights belong to the hotels module, and this module reaches them only through `HotelRoomHoldsService`.

## Reserve rooms and hold them for payment (HTL-16, HTL-18)

- `POST /api/hotel-bookings` is for registered users (role `user`) only. Admins and moderators get 403.
- The body is the hotel, the dates, and the rooms with the guests of each: `adults` and `childAges` (each 0 to 17). Every room needs at least one guest, and the reservation needs at least one adult (HTL-16), so a room with only children is allowed. Each room can be chosen once, and a reservation has 1 to 10 rooms, the same limit as the search (HTL-11). Room ids are compared in lower case.
- The client never sends a price, status, owner, hold or reference. `forbidNonWhitelisted` refuses them.
- Going to payment is this call, so it is when the 10-minute hold of HTL-18 starts. The reservation is created as `pending_payment` with `holdExpiresAt` = now + 10 minutes, and every night of every room is held in `room_nights` with the same moment.
- All or nothing: the rooms are held first and the reservation is saved after. If a room is not free, the request is refused with 409 and nothing is saved or held. If saving the reservation fails, the nights it held are released.
- The total is the sum over the rooms of nights x the room's price at that moment. Each booked room keeps its own price, a label (`101 (Double)`) and its guests, so later changes to the room do not change the reservation.
- The hotel's check-in and check-out times and its cancellation tiers are copied into the reservation for the confirmation (HTL-17) and the cancellation (HTL-21). A hotel that never set its policies can still be booked; the times are then `null` and the tiers empty, which means no refund.
- PAY-02: `acceptPolicies` must be `true`, and the moment is stored as `policyAcceptedAt`. Payment (PAY-01) can rely on it being set.
- `reference` stays empty until the payment succeeds, as HTL-17 says, so its unique index is `sparse`.

## Hold expiry (HTL-18, GEN-11)

- `HotelBookingExpiryService` runs every minute (`@nestjs/schedule`, registered once in `AppModule` with `ScheduleModule.forRoot()`). It finds up to 100 `pending_payment` reservations whose hold has ended and sets each to `expired` with an update that matches only while it is still `pending_payment`, then releases its held nights.
- Every query already ignores a held night whose `holdExpiresAt` has passed, so a room is free again the moment the hold ends, even before the job runs.
- For HTL-17 (confirmation after payment): confirm only with an update that matches `status: pending_payment` **and** `holdExpiresAt > now`. After the hold ends, another reservation may already have taken the nights, so a late payment must be refunded instead of confirmed. PAY-01 also cancels the PaymentIntent when the hold expires.

## My reservations (HTL-20)

- `GET /api/hotel-bookings` lists the logged-in user's own reservations and `GET /api/hotel-bookings/:id` opens one. Both are for registered users (role `user`). The owner always comes from the login, never from the request.
- Opening someone else's reservation answers 403, and a missing one 404, the same as the owner-only itinerary routes (ACC-11). Admins see all bookings through their own route (ACC-17), not this one.
- `group` gives the three tabs of the workbook. Upcoming: Confirmed with a check-out date that has not passed (a stay that is going on is still upcoming), plus Pending Payment with a live hold, so the user can still pay. Past: Completed, or Confirmed with a check-out date that has passed (until the completion job of HTL-23 marks it Completed). Cancelled: Cancelled. "Today" is the UTC date, as everywhere in the hotels module.
- An Expired reservation was never paid, so it is in no group; the list without `group` shows every reservation, expired ones included.
- Upcoming is sorted soonest check-in first; past and cancelled latest first; the list without a group newest first. The filter and the order are pure functions in `hotel-booking-groups.ts` with unit tests, and the (`userId`, `status`) index serves them.
- The list and the details return the same `HotelBookingResponseDto` (reference, hotel, rooms with guests and prices, dates, total, status, policies), so the details page needs no other call. `hotelName` is read from the hotels module with one query per page (`HotelsService.findNamesByIds`), because the reservation stores only the hotel id, as in the data model.

## The hotel's reservations, for its moderator (HTL-22)

- `GET /api/hotels/:id/reservations` is under `/hotels`, as in the endpoint table, but its controller (`HotelReservationsController`) lives in this module, because the reservations are this module's data. Only the moderator assigned to the hotel may call it: the hotels module's `findManagedEntityOrThrow` answers 404 for a missing hotel and 403 for anyone else, the same rule as every other moderator route of the hotel.
- Each item shows what the workbook asks for (guest, dates, status) plus the reference, the rooms with their guests and the total, so the moderator can prepare the stay. The guest's account id, the hold and the policy acceptance are left out.
- The guest is shown by name only. The names of one page are read in one query on the `User` model, which `UsersModule` exports, as the public itineraries do for their authors.
- Latest check-in first, paginated. Without `status`, every reservation except `expired` ones, which were holds that were never paid; `status=expired` still shows them. The (`hotelId`, `status`) index serves the query.

## Ratings and reviews (HTL-23)

- The routes are the ones of the endpoint table: `POST /api/hotel-bookings/:id/review`, `PATCH /api/reviews/:id` and `DELETE /api/reviews/:id`, all for registered users, in one `ReviewsController`. Reviews live in this module, as the module table of the spec says, in the `reviews` collection.
- A guest reviews their own reservation (403 otherwise, 404 if it does not exist) once it is completed. A Confirmed reservation whose check-out date has passed (UTC) counts as completed too, so the guest does not wait for the hourly job; one that ends today does not. A pending, expired or cancelled reservation answers 409.
- One review per reservation, whatever its number of rooms: the unique `bookingId` index decides, so two requests at once still give one review and a 409. After a delete, the reservation can be reviewed again.
- The rating is a whole number from 1 to 5, the text optional with at most 1000 characters, trimmed; an empty text means no text, and in an edit it removes the text. An edit with neither field answers 400.
- The hotel's `averageRating` and `ratingCount` are recomputed from all its reviews (one aggregation) after every new review, every rating change and every delete, and stored on the hotel through `HotelsService.setRating`, because the hotels module owns the hotel. The average is rounded to two decimals; a hotel without reviews goes back to 0 and 0, which HTL-12's `minRating` treats as unrated.
- Every review counts in the average, hidden ones too: hiding (GEN-10) is about the text, not the stay. The `moderation` field (`visible`/`hidden`) is in the schema for that; reporting reviews (GEN-09) and hiding them (GEN-10) belong to the reports and admin modules, whose `ReportTargetType` already says reviews come with HTL-23.
- The answer shows the author by name (one lookup on the `User` model that `UsersModule` exports), never the author's account id or the moderation state.

## Completed stays (HTL-23, GEN-11)

- `HotelBookingCompletionService` runs every hour. It finds up to 100 Confirmed reservations whose check-out date is before today (UTC) and sets each to Completed with an update that matches only while it is still Confirmed, so a reservation cancelled in the meantime stays Cancelled.

## A hotel's reviews, for everyone (HTL-24)

- `GET /api/hotels/:id/reviews` is public, in the same `ReviewsController`. It lists the reviews of an active hotel, newest first and paginated, each with its rating, text, author's name and dates. A deactivated or missing hotel answers 404, the same as the hotel page (ACC-15).
- Reviews hidden by an admin (GEN-10) are left out of this list. The (`hotelId`, `createdAt`) index serves the query, and the authors' names of one page are read with one query.
- The average rating and the number of ratings are not repeated in each page: they are `averageRating` and `ratingCount` on the hotel page (`GET /api/hotels/:id`) and in the search results, kept up to date by HTL-23. This keeps the list in the paginated shape every list of the API has.
