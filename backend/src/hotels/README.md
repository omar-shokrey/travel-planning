# Hotels

The hotels module owns the `hotels`, `rooms` and `room_nights` collections. It
implements the hotel profile and photos (HTL-01), the hotel page (HTL-02), rooms
and their availability, blocks and status (HTL-03 to HTL-06, HTL-08), the
policies (HTL-09, HTL-10), hotel search (HTL-11) and the free rooms of a hotel
for the searched dates (HTL-15). `HotelsService` creates profiles and lets a
moderator update only the hotel in their user assignment. It reads cities from
`ReferenceModule` and copies each city's country code into the hotel, so
callers cannot choose a mismatched country. Reservations (HTL-16 to HTL-22) are
not built yet.

## Routes

| Method and path                                    | Who                 | Requirement    |
| -------------------------------------------------- | ------------------- | -------------- |
| `POST /api/hotels`                                 | Admin               | HTL-01         |
| `PATCH /api/hotels/:id`                            | Its hotel moderator | HTL-01         |
| `POST /api/hotels/:id/photos`                      | Its hotel moderator | HTL-01, GEN-08 |
| `DELETE /api/hotels/:id/photos/:filename`          | Its hotel moderator | HTL-01, GEN-08 |
| `GET /api/hotels/search`                           | Public              | HTL-11         |
| `GET /api/hotels/:id/rooms/available`              | Public              | HTL-15         |
| `GET /api/hotels/:id`                              | Public              | HTL-02, HTL-15 |
| `POST /api/hotels/:id/rooms`                       | Its hotel moderator | HTL-03         |
| `PATCH /api/hotels/:id/rooms/:roomId`              | Its hotel moderator | HTL-05         |
| `DELETE /api/hotels/:id/rooms/:roomId`             | Its hotel moderator | HTL-06         |
| `POST /api/hotels/:id/rooms/:roomId/availability`  | Its hotel moderator | HTL-04         |
| `PATCH /api/hotels/:id/rooms/:roomId/availability` | Its hotel moderator | HTL-05, HTL-06 |
| `PATCH /api/hotels/:id/rooms/:roomId/deactivate`   | Its hotel moderator | HTL-06         |
| `PATCH /api/hotels/:id/rooms/:roomId/reactivate`   | Its hotel moderator | HTL-06         |
| `GET /api/hotels/:id/availability`                 | Its hotel moderator | HTL-08         |
| `PUT /api/hotels/:id/policies`                     | Its hotel moderator | HTL-09, HTL-10 |

`GET /api/hotels/:id` is held by `HotelDetailsController`, which stays last in
`HotelsModule`, so `GET /api/hotels/search` is matched before it and "search"
is not read as an id. That is the only path that depends on the order: a `:id`
parameter matches one path segment, so `GET /api/hotels/:id` never answers
`:id/rooms/available` or `:id/availability`. `hotels.module.spec.ts` checks
the order and which route answers each GET path.

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
- **Every feature that shows or books hotels must respect `active`:** hotel search (HTL-11) leaves out hotels with `active: false` (the `(cityId, active)` index is there for it), and the hotel page (HTL-02) and the free rooms of a hotel (HTL-15) answer 404 for them. Hotel booking (HTL-16) must refuse them; it does not exist yet, so this is the rule for whoever builds it. Confirmed bookings of a deactivated hotel stay valid.

## Hotel details (HTL-02)

- `GET /api/hotels/:id` is public: guests and users open the hotel page without login.
- It lives in its own `HotelDetailsController` and `HotelDetailsService`, so it does not collide with the profile and search work in the same module. The controller is registered last in `HotelsModule`: a controller with a fixed path such as `GET /hotels/search` must be matched before `GET /hotels/:id`, or "search" would be read as an id and answer 400.
- Only an active hotel is shown. A deactivated hotel answers 404, the same as a missing one, because ACC-15 hides it from the public.
- The response is `HotelDetailsResponseDto`: the `HotelResponseDto` of HTL-01 (profile, photos with their URLs, amenities, `averageRating` and `ratingCount`) plus `policy` (HTL-09, HTL-10) and `availableRooms` (HTL-15).
- The check-in and check-out times and the cancellation policy come in `policy` (HTL-09, HTL-10). The available rooms are on the page itself: with `checkIn` and `checkOut`, `availableRooms` lists every room free for the stay; without dates it is `null` (see "Available rooms for the searched dates" below). The reviews come from the issue that owns them, `GET /api/hotels/:id/reviews` (HTL-24), which is not built yet.

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
- The price per night is capped at `ROOM_PRICE_MAX` (1,000,000,000 minor
  units, 10,000,000.00) in the DTO and the schema; a higher price answers 400.
  The workbook gives no limit. It is an engineering limit: a reservation
  (HTL-16) multiplies the price by nights and rooms, and
  `ROOM_PRICE_MAX` x 366 nights x 1000 rooms = 3.66e14 stays below
  `Number.MAX_SAFE_INTEGER` (about 9.007e15), so totals stay exact whole
  numbers.
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
- The new price has the same cap as in HTL-03: at most `ROOM_PRICE_MAX` (1,000,000,000 minor units), or the request answers 400. The workbook gives no limit; it is an engineering limit so that a reservation total stays exact: `ROOM_PRICE_MAX` x 366 nights x 1000 rooms = 3.66e14, below `Number.MAX_SAFE_INTEGER` (about 9.007e15).
- The availability route takes the complete new list of ranges and replaces the old one. The HTL-04 route only adds a range; HTL-05 asks to edit availability, which also means shortening or removing ranges, and one list is the simplest way to do all three. Overlapping ranges answer 400; ranges that only touch are allowed, as in HTL-04. At most 100 ranges (`ROOM_AVAILABILITY_RANGES_MAX_COUNT`), a limit I chose because the workbook gives none.
- "Availability cannot be removed for dates with confirmed reservations": before saving, the service reads the room's nights in `room_nights` that are `booked`, or `held` with a hold that has not expired, and answers 409 if one of them would fall outside the new ranges. A held night counts too, because its reservation may still be paid and confirmed. A `blocked` night does not count: it is the moderator's own block (HTL-06).
- `room_nights` is the collection of the data model in the spec. I added its schema (`RoomNight`, with the unique (`roomId`, `date`) index) because HTL-05 needs to read it. Blocking (HTL-06) writes `blocked` nights to it; the holds and reservations of HTL-16 and HTL-18 will write `held` and `booked` ones. Until they exist no night is reserved, so the 409 can only be reached by the end-to-end test, which creates nights itself.
- The check and the save are two steps. A reservation made between them could end up outside the availability; the hold of HTL-18 must therefore check the availability again when it inserts its nights.

## Blocking dates, deactivating and deleting a room (HTL-06)

- Blocking uses the same `PATCH /api/hotels/:id/rooms/:roomId/availability` as HTL-05, because the endpoint table gives that route to both. The body now has two optional lists, `availability` (HTL-05) and `blocked` (HTL-06). Each list that is sent replaces the old one; a list that is left out stays as it is; a body with neither answers 400.
- A blocked night is a `room_nights` document with the state `blocked` and no reservation. The unique (`roomId`, `date`) index means a blocked night and a reserved night can never exist together, so a hold made at the same moment as a block cannot both succeed. If the insert of the blocks hits a night that a reservation took after the check, the request removes only the nights it inserted itself, found by the ids it chose, and answers 409.
- Blocking a night that a reservation has booked or holds answers 409 before anything is written. A hold whose time has passed no longer counts and is removed before the night is blocked, as the spec says for every new hold.
- The response of both room routes is `ManagedRoomResponseDto`: the HTL-03 room plus `blocked`, the blocked nights joined into date ranges. `RoomResponseDto` and its mapper are unchanged.
- One request can block at most 366 nights (`ROOM_BLOCK_MAX_NIGHTS`), one document per night. The workbook gives no limit.
- Deactivating and reactivating use `PATCH /api/hotels/:id/rooms/:roomId/deactivate` and `/reactivate`. The endpoint table has no route for them; the names follow the provider routes of ACC-15. A room with a reserved night from today (UTC) on cannot be deactivated; past stays do not count. A deactivated room keeps its blocks and availability. Hotel search (HTL-11) and the available rooms (HTL-15) leave out rooms whose `active` is false, and the reservation (HTL-16) must too.
- `DELETE /api/hotels/:id/rooms/:roomId` deletes a room only if no `room_nights` document with a reservation (`bookingId`) was ever stored for it, and removes its blocks with it. When the reservations of HTL-16 exist, the check should also look at `hotel_bookings`, because an expired hold may have been cleaned up.
- The checks and the writes of deactivation and deletion are separate steps. A hold inserted between them could end up on a deactivated or deleted room; the hold of HTL-18 must therefore check that the room still exists and is active.

## Room status for a date range (HTL-08)

- `GET /api/hotels/:id/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` is the route of the endpoint table. Only the moderator assigned to the hotel may call it. `from` is the first night and `to` the day after the last night, as for the availability ranges of HTL-04.
- Every room of the hotel is listed, deactivated ones too (with `active: false`), because the moderator manages them all. The rooms are paginated (GEN-05) and sorted by room number, with the digits compared as numbers (a MongoDB collation with `numericOrdering`), so room 2 comes before room 10. A room number is free text, and a plain text sort would put "10" before "2".
- Each room has `segments`: the whole range in order, with no gap. Consecutive nights with the same status and the same reservation are joined, so a long range stays short.
- The statuses are the three of the workbook plus one: `available`, `booked`, `blocked`, and `unavailable` for a night outside every availability range of the room. Calling such a night "available" would be wrong, because it cannot be booked.
- A night held by a reservation in Pending Payment whose hold has not expired is `booked` with `pendingPayment: true`, because HTL-06 also treats it as reserved. A hold whose time has passed is ignored, as everywhere else.
- The workbook asks for the reservation reference on a booked night. The reservations of HTL-16 and HTL-17 do not exist yet, so a booked segment shows the `bookingId` stored on the night. HTL-17 should add the `reference` next to it once `hotel_bookings` exists.
- A range has at most 366 nights (`ROOM_QUERY_MAX_NIGHTS`). The workbook gives no limit; this one keeps a page of rooms small.
- The status of each night is computed by the pure function `roomStatusSegments` in `room-status.ts`, so it is unit tested without a database. The service reads one page of rooms and their nights in the range with one query each.

## Hotel search (HTL-11)

- **Route.** `GET /api/hotels/search` is public: guests and users get the same answer. `HotelSearchController` is registered before `HotelDetailsController`, so `search` is never read as a hotel id.
- **Where.** Exactly one of `cityId` and `countryCode`; neither or both answer 400. A city or country with no hotel gives an empty page, not 404.
- **Dates.** `checkIn` and `checkOut` are `YYYY-MM-DD`; check-out must be after check-in (the query DTO), check-in cannot be before today in UTC and a stay has at most `ROOM_QUERY_MAX_NIGHTS` (366) nights (`assertStay` in `stay-rules.ts`, shared with HTL-15 and the hotel page, so all three answer the same 400 for the same stay). The stay is the nights from `checkIn` up to `checkOut`, not included, as everywhere else in the module.
- **Which rooms are free.** An active room (HTL-06) is free when every night of the stay is inside one of its availability ranges (HTL-04; ranges that touch count as one) and no night has a `room_nights` document that takes it: blocked (HTL-06), booked, or held by a hold that has not expired (HTL-18). An expired hold no longer counts, as in HTL-08. The database query only reads rooms bookable on the first night; the other nights are checked in `hotel-search.ts`, plain functions with unit tests. These functions (`roomsThatCanBeFree`, `nightsOfTheStay`, `groupNightsByRoom`, `isFreeForStay`) are the module's one free-room rule: the available rooms (HTL-15) use them too.
- **Which hotels are listed.** Active hotels (ACC-15) with at least `rooms` free rooms whose `rooms` largest free rooms together hold `guests`. The largest rooms are the best possible choice, so if they cannot hold the guests, no choice can. `rooms` defaults to 1. Fewer guests than rooms is allowed.
- **Result.** The public hotel fields, `freeRooms` (how many rooms are free for the stay) and `lowestPricePerNight` with `currency` (USD, PAY-04). Price filters and sorting are HTL-12. The rooms themselves are listed by `GET /api/hotels/:id/rooms/available` (HTL-15) with the same rule, so `freeRooms` is the `total` of that route for the same dates and `lowestPricePerNight` the lowest `pricePerNight` it lists.
- **Order and pages.** By hotel name (case is ignored), then id, 10 per page (GEN-05). Every matching hotel is counted for `total`, so the hotels and their rooms of the city or country are read in one go and paged in memory. That is fine for the size of the data; a very large country would need the free-room check in the database.
- **Limits (engineering limits, not workbook rules).** `guests` 1 to `HOTEL_SEARCH_GUESTS_MAX` (100), `rooms` 1 to `HOTEL_SEARCH_ROOMS_MAX` (20).
- **Reading only.** The search writes nothing. A room in the results can be gone when the user books it; booking (HTL-16) takes the nights in its own concurrency-safe way.
- **Used by the itineraries module (ITN-25).** `HotelsModule` exports `HotelSearchService`, and `ItineraryHotelsService` calls `search()` with the city and the dates of a city group, so the hotels of a group follow the free-room rule above and cannot disagree with this route. Nothing else of the module is exported for it; `HotelAvailableRoomsService` stays private.

## Available rooms for the searched dates (HTL-15)

- **Route.** `GET /api/hotels/:id/rooms/available?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD` is public, as the endpoint table says: guests and users get the same answer. Its path has more segments than `GET /api/hotels/:id`, so the order of the controllers does not matter for it. A malformed hotel id answers 400, and a missing or deactivated hotel (ACC-15) 404 "Hotel not found", exactly like the hotel page.
- **One free-room rule.** The rule is in `hotel-search.ts` and hotel search uses the same code: a room is free when it is active (HTL-06), its availability ranges (HTL-04) cover every night from check-in up to the day before check-out, and no night of the stay has a `room_nights` document that is booked, blocked (HTL-06) or held by a hold that has not expired (HTL-18; a hold that expires exactly now no longer counts). The check-out day is not a night, so a reservation that starts that day does not matter. It has four parts that a caller uses together: `roomsThatCanBeFree(stay)`, the `rooms` filter (active rooms bookable on the first night); `nightsOfTheStay(roomIds, stay)`, the `room_nights` filter (the nights from check-in up to the day before check-out); `groupNightsByRoom(nights)`, which gives each room its nights; and `isFreeForStay`, which checks every night of each room against its availability and its nights. `HotelAvailableRoomsService` reads the rooms of the one hotel and their nights with the two filters (one query each), groups the nights by room and applies `isFreeForStay`, exactly as `HotelSearchService` does for many hotels. There is no second copy of the rule: two copies would drift apart and show a room on one route that the other says is taken. HTL-16 and HTL-18 should use the same four parts, and still rely on the unique (`roomId`, `date`) index.
- **Same answer as hotel search.** For the same dates, the rooms listed here are exactly the rooms search counts as `freeRooms` for the hotel, and its `lowestPricePerNight` is the lowest `pricePerNight` listed. The e2e test checks this over HTTP for six stays. The stay checks are shared too (`assertStay` in `stay-rules.ts`): check-in not before today (UTC) and at most `ROOM_QUERY_MAX_NIGHTS` (366) nights, as in search, with the same 400 body naming the field. That check-out is after check-in is checked by the query DTO with the same validators as search. The workbook gives no limit on the length; 366 is the module's limit for every date range.
- **Each room.** `id` (the room id, which the reservation of HTL-16 selects), `number`, `type`, `beds`, `maxOccupancy`, `pricePerNight`, `nights`, `totalPrice` = nights x `pricePerNight`, and `currency` (USD, PAY-04). Money is whole minor units: `ROOM_PRICE_MAX` x 366 nights = 3.66e11 is a safe integer. Nothing internal (availability, `active`, `hotelId`, timestamps) is returned.
- **No `guests` or `rooms` parameter.** HTL-15 asks for every free room, not for the rooms that fit a party; `maxOccupancy` is shown so the user can choose, and HTL-16 checks the guests per room. An unknown parameter answers 400.
- **Order and pages.** By room number, with the digits compared as numbers (2 before 10, as in HTL-08), then id; 10 per page (GEN-05). Whether a room is free depends on two collections, so the free rooms of the hotel are found first and paged in memory; one hotel has few rooms.
- **The hotel page (HTL-02).** HTL-02 shows "the available rooms when dates are provided". `GET /api/hotels/:id` takes the same `checkIn` and `checkOut` as optional parameters (`HotelDetailsQueryDto`): with both it adds `availableRooms`, the full list without pages, from the same `listAvailable` method as the route, so the two cannot disagree; without dates it is `null`; with only one date it answers 400. The page applies the same `assertStay` before it reads the hotel.
- **Read only.** The route writes nothing and locks nothing. A listed room can be taken before the user books it, so the hold of HTL-18 must take the nights through the unique (`roomId`, `date`) index of `room_nights` and not trust this list.
