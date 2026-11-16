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
- The e2e test `hotels-profile.e2e-spec.ts` runs the whole flow on the test database: it adds its own countries and cities (unique ids), stores a hotel and its moderator, and removes them all at the end.

Hotel photos use `UploadsService`; the hotel stores only generated filenames.
Uploads use a conditional photo-count update to prevent concurrent requests
from exceeding the five-photo limit. A removed filename is deleted from the
hotel before its file is removed.

## Hotel details (HTL-02)

- `GET /api/hotels/:id` is public: guests and users open the hotel page without login.
- It lives in its own `HotelDetailsController` and `HotelDetailsService`, so it does not collide with the profile and search work in the same module. The controller is registered last in `HotelsModule`: a controller with a fixed path such as `GET /hotels/search` must be matched before `GET /hotels/:id`, or "search" would be read as an id and answer 400.
- Only an active hotel is shown. A deactivated hotel answers 404, the same as a missing one, because ACC-15 hides it from the public.
- The response is the `HotelResponseDto` of HTL-01: profile, photos with their URLs, amenities, `averageRating` and `ratingCount`.
- The other parts of the hotel page come from the issues that own their data: check-in and check-out times and the cancellation policy are added to this response by HTL-09 and HTL-10, the reviews are read from `GET /api/hotels/:id/reviews` (HTL-24), and the rooms free for chosen dates from `GET /api/hotels/:id/rooms/available` (HTL-15).
