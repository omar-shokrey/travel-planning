# Hotels

The hotels module owns the `hotels` collection. `HotelsService` creates profiles
and lets a moderator update only the hotel in their user assignment. It reads
cities from `ReferenceModule` and copies each city's country code into the
hotel, so callers cannot choose a mismatched country.

## Profile (HTL-01)

- `POST /api/hotels` is for the admin only and `PATCH /api/hotels/:id` for the hotel moderator assigned to that hotel only, as the requirement says ("an admin creates", "a hotel moderator edits their hotel"). An admin editing, or a moderator of another hotel, answers 403.
- `HotelsService.findEntityOrThrow(id)` returns the stored hotel or 404, for other services (ACC-13 checks a new moderator's hotel with it). No controller exposes it.
- The server sets `countryCode` (from the city), `active` (true), the photos (empty; added with `POST /api/hotels/:id/photos`) and the rating counters. The DTO does not accept them, so sending one answers 400.
- **`null` in an edit answers 400.** `UpdateHotelDto` comes from `PartialType`, which makes every field `@IsOptional()`, and that lets `null` through as well as a missing field. Every hotel field is required, so `HotelsService.update` checks first, before reading anything, and answers 400 in the usual shape (`errors` names each field, "name must not be null"). Without it, `null` reached the schema on save, and the exception filter turned the Mongoose `ValidationError` into a 500.
- Amenities are trimmed and duplicates are removed (the first is kept) before the 30-amenity limit is checked, on create and edit.
- The photo updates use `returnDocument: 'after'`, like the rest of the code; Mongoose 9 still accepts `new: true` but marks it deprecated.
- The e2e test `hotels-profile.e2e-spec.ts` creates its own countries and cities
  (unique ids), then removes those and its hotel and users at the end.

## Photos (HTL-01, GEN-08)

- Hotel photos use `UploadsService`; the hotel stores only the generated filenames.
- Uploads use a conditional photo-count update, so concurrent requests cannot exceed the five-photo limit.
- A removed filename is deleted from the hotel before its file is removed.

## Deactivated hotels (ACC-15)

- An admin deactivates or reactivates a hotel through `PATCH /api/admin/providers/hotel/:id/deactivate` and `/reactivate`. `HotelsService.setActive(id, active)` writes the flag for the admin module, with one conditional update. No hotels route exposes it.
- **Every feature that shows or books hotels must respect `active`:** hotel search (HTL-11) leaves out hotels with `active: false` (the `(cityId, active)` index is there for it), and hotel booking (HTL-16) refuses them. Confirmed bookings of a deactivated hotel stay valid. These routes do not exist yet; this is the rule for whoever builds them.

## Hotel details (HTL-02)

- `GET /api/hotels/:id` is public: guests and users open the hotel page without login.
- It lives in its own `HotelDetailsController` and `HotelDetailsService`, so it does not collide with the profile and search work in the same module. The controller is registered last in `HotelsModule`: a controller with a fixed path such as `GET /hotels/search` must be matched before `GET /hotels/:id`, or "search" would be read as an id and answer 400.
- Only an active hotel is shown. A deactivated hotel answers 404, the same as a missing one, because ACC-15 hides it from the public.
- The response is `HotelDetailsResponseDto`: the `HotelResponseDto` of HTL-01 (profile, photos with their URLs, amenities, `averageRating` and `ratingCount`) plus `policy` (HTL-09, HTL-10) and `availableRooms` (HTL-15).
- The check-in and check-out times and the cancellation policy come in `policy` (HTL-09, HTL-10). The rooms free for chosen dates are on the page itself when `checkIn` and `checkOut` are sent (see HTL-15). The reviews are read from `GET /api/hotels/:id/reviews` (HTL-24).

## Check-in and check-out times (HTL-09)

- The policies are embedded in the hotel document as `policy` (`HotelPolicy` schema), as in the data model of the spec, because they belong to exactly one hotel.
- `checkInTime` and `checkOutTime` are `HH:mm` strings on the 24-hour clock, local to the hotel. They are a time without a date, so they are never stored as a `Date` and no time zone can shift them.
- `PUT /api/hotels/:id/policies` is for the hotel moderator assigned to that hotel. `PUT` replaces the policies as a whole, so both times are required. HTL-10 adds the cancellation tiers to the same route.
- There is no rule that check-out is earlier than check-in: they are times on different days of a stay.
- A hotel has no policies until its moderator sets them. The hotel page (`GET /api/hotels/:id`) then shows `policy: null`; no default times are invented.
- `HotelResponseDto` and its mapper are unchanged; the hotel page adds `policy` to them in `HotelDetailsResponseDto`.
- `HotelsService.findManagedEntityOrThrow(hotelId, userId)` is new: it returns the hotel entity after the same "is this the moderator's hotel" check that HTL-01 uses (404 for a missing hotel, 403 for another moderator). The policy service calls it, and the room services of this module can use it too, so the ownership rule lives in one place.

## Cancellation tiers (HTL-10)

- The tiers are embedded in the hotel's `policy` as `cancellationTiers`, as in the data model of the spec. Each tier has `daysBefore` (whole days before check-in, 0 or more) and `refundPercent` (a whole number from 0 to 100).
- They are set with the same `PUT /api/hotels/:id/policies` as the times, because the endpoint table gives HTL-09 and HTL-10 one route. `PUT` replaces the policies as a whole, so `cancellationTiers` is required; an empty list means "no refund".
- Two tiers of one hotel cannot have the same `daysBefore`; the request answers 400. Each tier must be an object with both numbers: a tier sent as a list, `null` or a number answers 400. A hotel has at most 10 tiers (`HOTEL_CANCELLATION_TIERS_MAX_COUNT`), a limit I chose because the workbook gives none.
- The tiers are stored and returned with the highest threshold first, whatever order they were sent in.
- The selection rule is the one of FLT-09, shared with flights in `common/cancellation-tiers.ts`: `refundPercentFor(tiers, daysRemaining)` picks the tier with the highest threshold that does not exceed the days remaining, and 0% if no tier applies. The cancellation of a reservation (HTL-21) and the refund (PAY-03) call it with the tiers copied into the reservation. `sortTiersByDaysBefore` from the same file gives the stored and returned order.
- The percentages are not forced to rise with the threshold. The workbook does not ask for it, and the rule above gives one clear answer for any list.
- The hotel page (`GET /api/hotels/:id`) shows the tiers inside `policy`.

## Rooms (HTL-03)

- `POST /api/hotels/:id/rooms` is limited to the moderator assigned to that
  hotel. The service verifies both the hotel and the moderator assignment
  before creating a room.
- Rooms are stored in the separate `rooms` collection with a compound unique
  index on `{ hotelId, number }`, so a room number can be reused at another
  hotel but not within the same hotel. MongoDB enforces this even for concurrent
  creates; the shared exception filter reports a duplicate as 409.
- The DTO accepts only `number`, `type`, `beds`, `maxOccupancy` and
  `pricePerNight`. It trims the text fields and requires positive whole-number
  beds, occupancy and price (minor units). The server sets `hotelId` and
  `active`.
- The real-AppModule e2e coverage is in `hotels-rooms.e2e-spec.ts`; it creates
  its own hotels and users, explicitly awaits the room indexes before testing
  hotel-scoped uniqueness, and removes its fixtures at the end.

## Room availability (HTL-04)

- `POST /api/hotels/:id/rooms/:roomId/availability` is limited to the moderator
  assigned to the hotel and returns the updated room with its availability.
- Availability ranges are embedded on the room as `from` and `to` date-only
  strings. Ranges use `[from, to)` semantics: the first night is included and
  the checkout boundary is excluded, so adjacent ranges can meet without
  overlapping.
- The service adds a range with a conditional atomic update that checks for
  overlap and appends only when none exists. Concurrent requests therefore
  cannot both add overlapping ranges.
- Past ranges are accepted because HTL-04 sets no limit; bookings are checked
  against dates later (HTL-11/HTL-18).

## Editing a room (HTL-05)

- `PATCH /api/hotels/:id/rooms/:roomId` changes `beds`, `maxOccupancy` and `pricePerNight`, and `PATCH /api/hotels/:id/rooms/:roomId/availability` changes the availability, as in the endpoint table. Both are for the moderator assigned to the hotel, checked through `HotelsService.findManagedEntityOrThrow`. A room of another hotel answers 404, because the room is looked up inside the hotel of the route.
- The code is in its own `HotelRoomsService` and `HotelRoomsController`, so it does not collide with the room creation and availability code of HTL-03 and HTL-04 in `HotelsService`.
- `UpdateRoomDto` lists only the three fields HTL-05 names. The room number and type are not editable here, and a body with only unknown fields or no field answers 400. A field sent as `null` answers 400, because every room field is required.
- A new price applies to new reservations only. A reservation stores the price it was made at, so changing the room's price changes nothing that already exists.
- The availability route takes the complete new list of ranges and replaces the old one. The HTL-04 route only adds a range; HTL-05 asks to edit availability, which also means shortening or removing ranges, and one list is the simplest way to do all three. Overlapping ranges answer 400; ranges that only touch are allowed, as in HTL-04. At most 100 ranges (`ROOM_AVAILABILITY_RANGES_MAX_COUNT`), a limit I chose because the workbook gives none.
- "Availability cannot be removed for dates with confirmed reservations": before saving, the service reads the room's nights in `room_nights` that are `booked`, or `held` with a hold that has not expired, and answers 409 if one of them would fall outside the new ranges. A held night counts too, because its reservation may still be paid and confirmed. A `blocked` night does not count: it is the moderator's own block (HTL-06).
- `room_nights` is the collection of the data model in the spec. I added its schema (`RoomNight`, with the unique (`roomId`, `date`) index) because HTL-05 needs to read it. Nothing writes to it yet: the holds and reservations of HTL-16 and HTL-18 will. Until then no night is reserved, so the 409 can only be reached by the end-to-end test, which creates nights itself.
- The check and the save are two steps. A reservation made between them could end up outside the availability; the hold of HTL-18 must therefore check the availability again when it inserts its nights.

## Blocking dates, deactivating and deleting a room (HTL-06)

- Blocking uses the same `PATCH /api/hotels/:id/rooms/:roomId/availability` as HTL-05, because the endpoint table gives that route to both. The body now has two optional lists, `availability` (HTL-05) and `blocked` (HTL-06). Each list that is sent replaces the old one; a list that is left out stays as it is; a body with neither answers 400.
- A blocked night is a `room_nights` document with the state `blocked` and no reservation. The unique (`roomId`, `date`) index means a blocked night and a reserved night can never exist together, so a hold made at the same moment as a block cannot both succeed. If the insert of the blocks hits a night that a reservation took after the check, the request removes only the nights it inserted itself, found by the ids it chose, and answers 409.
- Blocking a night that a reservation has booked or holds answers 409 before anything is written. A hold whose time has passed no longer counts and is removed before the night is blocked, as the spec says for every new hold.
- The response of both room routes is `ManagedRoomResponseDto`: the HTL-03 room plus `blocked`, the blocked nights joined into date ranges. `RoomResponseDto` and its mapper are unchanged.
- One request can block at most 366 nights (`ROOM_BLOCK_MAX_NIGHTS`), one document per night. The workbook gives no limit.
- Deactivating and reactivating use `PATCH /api/hotels/:id/rooms/:roomId/deactivate` and `/reactivate`. The endpoint table has no route for them; the names follow the provider routes of ACC-15. A room with a reserved night from today (UTC) on cannot be deactivated; past stays do not count. A deactivated room keeps its blocks and availability. HTL-11 (search) and HTL-16 (reservation) must leave out rooms whose `active` is false.
- `DELETE /api/hotels/:id/rooms/:roomId` deletes a room only if no `room_nights` document with a reservation (`bookingId`) was ever stored for it, and removes its blocks with it. When the reservations of HTL-16 exist, the check should also look at `hotel_bookings`, because an expired hold may have been cleaned up.
- The checks and the writes of deactivation and deletion are separate steps. A hold inserted between them could end up on a deactivated or deleted room; the hold of HTL-18 must therefore check that the room still exists and is active.

## Room status for a date range (HTL-08)

- `GET /api/hotels/:id/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` is the route of the endpoint table. Only the moderator assigned to the hotel may call it. `from` is the first night and `to` the day after the last night, as for the availability ranges of HTL-04.
- Every room of the hotel is listed, deactivated ones too (with `active: false`), because the moderator manages them all. The rooms are paginated (GEN-05) and sorted by room number.
- Each room has `segments`: the whole range in order, with no gap. Consecutive nights with the same status and the same reservation are joined, so a long range stays short.
- The statuses are the three of the workbook plus one: `available`, `booked`, `blocked`, and `unavailable` for a night outside every availability range of the room. Calling such a night "available" would be wrong, because it cannot be booked.
- A night held by a reservation in Pending Payment whose hold has not expired is `booked` with `pendingPayment: true`, because HTL-06 also treats it as reserved. A hold whose time has passed is ignored, as everywhere else.
- The workbook asks for the reservation reference on a booked night. The reservations of HTL-16 and HTL-17 do not exist yet, so a booked segment shows the `bookingId` stored on the night. HTL-17 should add the `reference` next to it once `hotel_bookings` exists.
- A range has at most 366 nights (`ROOM_QUERY_MAX_NIGHTS`). The workbook gives no limit; this one keeps a page of rooms small.
- The status of each night is computed by the pure function `roomStatusSegments` in `room-status.ts`, so it is unit tested without a database. The service reads one page of rooms and their nights in the range with one query each.

## Available rooms for the searched dates (HTL-15)

- `GET /api/hotels/:id/rooms/available?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD` is public, as the endpoint table says. It lists every room of an active hotel that is free for the whole stay, paginated (GEN-05) and sorted by room number. A deactivated hotel answers 404, as on the hotel page.
- HTL-02 says the hotel page shows "the available rooms when dates are provided". So `GET /api/hotels/:id` takes the same two dates as optional query parameters and then adds `availableRooms`, the full list without pagination; without dates it is `null`. Sending only one date answers 400. Both routes use the same service method, so they can never disagree.
- A room is free when it is active (HTL-06), its availability ranges (HTL-04) cover every night from check-in up to the day before check-out, and no night of the stay has a `room_nights` document that is booked, blocked, or held with a hold that has not expired. The check-out day is not a night of the stay, so a reservation that starts that day does not matter.
- The date rules are the ones of HTL-11 and HTL-18: check-out after check-in (checked by the DTO), and check-in not in the past (UTC, checked by the service because "today" changes). A stay has at most 366 nights (`ROOM_QUERY_MAX_NIGHTS`); the workbook gives no limit.
- Each room shows the fields of the workbook (type, beds, maximum occupancy, price per night) plus its number, the number of nights and `totalPrice` = nights x price per night, in minor units of the platform currency.
- The rooms are read with one query and the taken ones with one `distinct` on `room_nights`; the coverage check runs in memory on the embedded availability ranges. The free list is paginated in memory, because whether a room is free depends on both collections.
- `findFreeRoomEntities` is the rule for hotel search (HTL-11) and booking (HTL-16), so they should call it instead of writing their own. It is only a read: a room can be taken right after it, so the hold of HTL-18 must still rely on the unique (`roomId`, `date`) index.
