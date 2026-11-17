# flights

Owns airline profile persistence for FLT-01: the `airlines` collection, `Airline` schema, `AirlinesService`, controller, request and response DTOs, and response mapper. The implemented scope in this module is airline profile creation, retrieval, and update (FLT-01), and the airline cancellation policy (FLT-09).

## Built so far

| Route                                       | Requirement | Access                             |
| ------------------------------------------- | ----------- | ---------------------------------- |
| `POST /api/airlines`                        | FLT-01      | Administrator                      |
| `GET /api/airlines/:id`                     | FLT-01      | Anyone (guest)                     |
| `PATCH /api/airlines/:id`                   | FLT-01      | Airline moderator for that airline |
| `PUT /api/airlines/:id/cancellation-policy` | FLT-09      | Airline moderator for that airline |

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

## Cancellation policy (FLT-09)

`PUT /api/airlines/:id/cancellation-policy` sets the cancellation tiers of an airline and returns the airline (200). Only the airline moderator assigned to that airline may call it.

- **The policy is embedded in the airline.** The airline has a `policy` sub-document (`AirlinePolicy`), as in the Flights data model, which holds `cancellationTiers: { daysBefore, refundPercent }[]`. Tiers have no `_id`. An airline starts with no tiers, and an airline stored before FLT-09 reads as having none. The baggage fields of the policy (`extraBagPrice`, `maxExtraBags`) come with FLT-04 and FLT-08.
- **`PUT` replaces the whole list.** The body is `{ "tiers": [...] }`. The tiers sent become the policy, with nothing kept from before. An empty list means "no refund at all". The write is one `findByIdAndUpdate` with `$set` on `policy.cancellationTiers`, so a reader never sees half a policy.
- **Stored highest threshold first.** The service sorts the tiers by `daysBefore`, descending, before it saves them, so whoever reads them (the airline profile, the future booking) needs no sorting.
- **Validation in the DTO.** `daysBefore` is a whole number of 0 or more, `refundPercent` a whole number from 0 to 100, and each `daysBefore` appears once in a request: a repeated one gets 400 with a message that names it. Each tier must be an object (a tier sent as a list is refused, not walked into), and a body without `tiers`, or with `tiers` that is not a list, gets only the messages that are true for it. A tier with an unknown field, or a body with one, is refused.
- **At most 20 tiers.** The workbook sets no limit. It is an engineering safeguard (`CANCELLATION_TIERS_MAX_COUNT`) that keeps a policy small enough to show and to copy into every booking.
- **Who may set it.** `@Roles(Role.AirlineModerator)`, then the service checks the moderator's `assignment` against the airline, as `update` does: a moderator of another airline gets 403, an administrator, a user and a hotel moderator get 403 from the role guard, a guest 401. A missing airline is 404 and a malformed id 400 (`ParseObjectIdPipe`). `update` and `setCancellationPolicy` each check the assignment their own way for now: an account that no longer exists gets 404 "User not found" from `update` and 403 here. Sharing one helper is a later refactor.
- **Everyone sees the policy.** `AirlineResponseDto` has `cancellationTiers` (always a list, empty by default), so `GET /api/airlines/:id` shows the policy to guests before they book, and the `PUT` returns it. The tiers are returned flat, not under a `policy` object. When the baggage rules arrive (FLT-04, FLT-08), that pull request decides whether they also go flat or the whole policy moves under `policy`; the second choice changes this response.
- **The refund rule is one pure function.** `refundPercentFor(tiers, daysRemaining)` in `cancellation-policy.ts` returns the `refundPercent` of the tier with the highest `daysBefore` that does not exceed `daysRemaining`, or 0 when no tier applies (an empty policy, fewer days than the smallest threshold, or a negative number). It reads neither the database nor the clock. The booking cancellation (FLT-26, PAY-03) computes `daysRemaining`, the whole number of days between the cancellation and the departure, and must use the tiers **copied into the booking** when it was made, as the data model says, so a later policy change never changes the refund of an existing booking.
- **Tests:** `cancellation-policy.spec.ts` (the refund rule), `dto/update-cancellation-policy.dto.spec.ts`, the `setCancellationPolicy` cases in `airlines.service.spec.ts`, `airlines.controller.spec.ts` (roles), the mapper spec, and `test/airlines-cancellation-policy.e2e-spec.ts`.
