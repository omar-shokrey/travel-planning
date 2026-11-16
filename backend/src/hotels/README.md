# Hotels

The hotels module owns the `hotels` collection. `HotelsService` creates profiles
and lets a moderator update only the hotel in their user assignment. It reads
cities from `ReferenceModule` and copies each city's country code into the
hotel, so callers cannot choose a mismatched country.

## Profile (HTL-01)

- `POST /api/hotels` is for the admin only and `PATCH /api/hotels/:id` for the hotel moderator assigned to that hotel only, as the requirement says ("an admin creates", "a hotel moderator edits their hotel"). An admin editing, or a moderator of another hotel, answers 403.
- The server sets `countryCode` (from the city), `active` (true), the photos (empty; added with `POST /api/hotels/:id/photos`) and the rating counters. The DTO does not accept them, so sending one answers 400.
- **`null` in an edit answers 400.** `UpdateHotelDto` comes from `PartialType`, which makes every field `@IsOptional()`, and that lets `null` through as well as a missing field. Every hotel field is required, so `HotelsService.update` checks first, before reading anything, and answers 400 in the usual shape (`errors` names each field, "name must not be null"). Without it, `null` reached the schema on save, and the exception filter turned the Mongoose `ValidationError` into a 500.
- Amenities are trimmed and duplicates are removed (the first is kept) before the 30-amenity limit is checked, on create and edit.
- The photo updates use `returnDocument: 'after'`, like the rest of the code; Mongoose 9 still accepts `new: true` but marks it deprecated.
- The e2e test `hotels-profile.e2e-spec.ts` creates its own countries and cities
  (unique ids), then removes those and its hotel and users at the end.

Hotel photos use `UploadsService`; the hotel stores only generated filenames.
Uploads use a conditional photo-count update to prevent concurrent requests
from exceeding the five-photo limit. A removed filename is deleted from the
hotel before its file is removed.

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
