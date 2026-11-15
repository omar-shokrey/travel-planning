# flights

Owns airline profile persistence for FLT-01: the `airlines` collection, `Airline` schema, `AirlinesService`, controller, request and response DTOs, and response mapper. The implemented scope in this module is airline profile creation, retrieval, and update.

## Built so far

| Route                     | Requirement | Access                             |
| ------------------------- | ----------- | ---------------------------------- |
| `POST /api/airlines`      | FLT-01      | Administrator                      |
| `GET /api/airlines/:id`   | FLT-01      | Anyone (guest)                     |
| `PATCH /api/airlines/:id` | FLT-01      | Airline moderator for that airline |

Creation accepts `name`, `code`, and a required multipart `logo`. Updates accept `name` and `code`, and can replace the logo. Duplicate airline codes return 409.

## Design decisions

- **The airline schema owns profile persistence.** Mongoose stores profiles in the `airlines` collection, applies timestamps, defaults `active` to `true`, and enforces a unique index on `code`.
- **The service owns database access and profile rules.** It checks duplicate codes, verifies that an airline moderator is assigned to the airline being updated, and provides `findEntityOrThrow()` for internal callers that need the raw entity.
- **Controllers return response DTOs, not Mongoose documents.** `AirlineResponseDto` and `toAirlineResponse()` expose `id`, `name`, `code`, the stored logo filename, `logoUrl`, `active`, `createdAt`, and `updatedAt`. The mapper converts `_id` to a string, builds `logoUrl` with the shared upload URL helper, and formats timestamps as UTC ISO strings ending in `Z`.
- **`GET /api/airlines/:id` is open to guests.** An airline's name, code, logo and active flag are public information that guests see in flight search results, so the route is `@Public()`. Creating and editing an airline still need a login, and only those two routes show the lock in Swagger.
- **Route IDs use the shared `ParseObjectIdPipe`.** A malformed airline ID is rejected with 400 before the service looks up the profile.
- **The client cannot set server-controlled profile fields.** The request DTOs accept only `name` and `code`; fields such as `active` and `_id` are rejected by validation.
- **Logo files use the shared image upload service.** Airline logos are limited to one image, JPG or PNG identified from its file signature, and 5 MB per image. The profile stores the returned filename; the image is served through `/api/uploads/<filename>`. Replacing a logo removes the previous file, and a failed database write removes the newly uploaded file.
- **Tests:** `airlines.service.spec.ts` covers service behavior. `backend/test/airlines.e2e-spec.ts` covers the airline profile routes, access rules, validation, and logo lifecycle.
