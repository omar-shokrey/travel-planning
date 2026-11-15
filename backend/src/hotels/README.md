# Hotels

The hotels module owns the `hotels` collection. `HotelsService` creates profiles
and lets a moderator update only the hotel in their user assignment. It reads
cities from `ReferenceModule` and copies each city's country code into the
hotel, so callers cannot choose a mismatched country.

## Profile (HTL-01)

- `POST /api/hotels` is for the admin only and `PATCH /api/hotels/:id` for the hotel moderator assigned to that hotel only, as the requirement says ("an admin creates", "a hotel moderator edits their hotel"). An admin editing, or a moderator of another hotel, answers 403.
- The server sets `countryCode` (from the city), `active` (true), the photos (empty; added with `POST /api/hotels/:id/photos`) and the rating counters. The DTO does not accept them, so sending one answers 400.
- **`null` in an edit answers 400.** `UpdateHotelDto` comes from `PartialType`, which makes every field `@IsOptional()`, and that lets `null` through as well as a missing field. Every hotel field is required, so `HotelsService.update` checks first, before reading anything, and answers 400 in the usual shape (`errors` names each field, "name must not be null"). Without it, `null` reached the schema on save, and the exception filter turned the Mongoose `ValidationError` into a 500.
- The e2e test `hotels-profile.e2e-spec.ts` runs the whole flow on the test database: it adds its own countries and cities (unique ids), stores a hotel and its moderator, and removes them all at the end.

Hotel photos use `UploadsService`; the hotel stores only generated filenames.
Uploads use a conditional photo-count update to prevent concurrent requests
from exceeding the five-photo limit. A removed filename is deleted from the
hotel before its file is removed.
