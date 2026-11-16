# Itineraries module

Owner: Ali Ghayesh (M8). Requirements: ITN-01 to ITN-26. Routes: `/api/itineraries`, `/api/activities`, `/api/budgets`, `/api/transport-costs`.

## Design decisions

- **One document per itinerary.** Days, activities, budget entries, transport costs and the clone source are embedded in the `itineraries` collection, as in the data model of `specs/travel-platform.md`. An itinerary has one owner, at most 60 days (ITN-05), and is always read together.
- **Nothing derived is stored.** The day number is the position in `days`, and a day's date is `startDate` plus that position. City groups and budget totals are computed when read. The only stored copy is `dayCount`, which the service keeps equal to `days.length` so that public search can filter by duration with an index (ITN-21).
- **`startDate` is a `YYYY-MM-DD` string**, never a `Date`, so no time zone can shift it.
- **Money is whole minor units plus a currency code.** Each entry keeps its own currency and is converted only when read (ITN-18).
- **Every embedded item has its own `_id`**, because the routes address them directly (`/api/activities/:id`, `/api/budgets/:id`, `/api/transport-costs/:id`).
- **Countries and cities are stored as the official ids** of the reference data (`EG`, `cairo`). The service checks that they exist in the `countries` and `cities` collections, which `ReferenceModule` exports for reading.
- **Transport `mode` is free text.** The workbook lists no fixed set of modes (ITN-16).
- **Enums live in `enums/`** inside this module. `ItineraryModeration` (visible or hidden, GEN-10) is local for now. If blog posts and reviews need the same values, it should move to `backend/src/common/enums/` in a shared PR.

## ITN-01: create, edit, delete

- **The owner comes from the login cookie.** `CreateItineraryDto` has no owner, visibility or day count, and the global `ValidationPipe` rejects unknown fields, so a client cannot set them.
- **Countries are checked against the `countries` collection** in the service. The DTO only checks the shape (2-letter codes, at least one, no repeats). An unknown code gives 400 and names the code.
- **Ownership is 404, then 403.** A missing itinerary gives 404. An itinerary of another user gives 403, as section 11 of the development plan asks.
- **Delete removes the document.** It leaves public search at once, and a clone is a separate document with the author's name copied into `cloneSource`, so clones are not affected. The "after confirmation" step is the frontend's dialog (Milestone 2).
- **`PATCH` changes only the fields that are sent.** A field that is absent or `null` is left as it is.
- **`findEntityOrThrow()`** is for other services (for example the admin module, GEN-10). It returns the entity and is never used by a controller.
- **Admin moderation (GEN-10)** uses `existsById`, `setHidden(id, hidden)` and `removeByAdmin(id)`, at the end of `ItinerariesService`, for the admin module only. `setHidden` changes `moderation` in one conditional update and answers `false` when nothing changed (missing, or already in that state). `removeByAdmin` deletes any itinerary and returns the activity image file names that no other itinerary uses: a clone keeps the image names of its source (ITN-21), so a file a clone still shows is kept. A hidden itinerary stays visible to its owner (`GET /api/itineraries` and `/:id` filter on the owner only, so they need no change) and is left out for everyone else by GEN-09 reports and by public search and view (ITN-21, which filters on `moderation: visible`). The owner's responses do not show `moderation` yet: adding it changes the response shape that the open ITN PRs test, so it is left for after they merge.
- **The end-to-end tests add their own country.** The test database may hold no reference data (CI starts with an empty one), so the tests insert one country with a code that no real country has (`X` plus a letter) and delete it at the end, with the users and itineraries they created.

## ITN-03: list my itineraries, open one

- **The list returns the summary only** (title, countries, start date, number of days, visibility). The days come with `GET /api/itineraries/:id`, so a list of 10 itineraries never loads up to 600 days.
- **Sorted by `updatedAt`, newest first, then by `_id`**, so two itineraries updated in the same millisecond keep a fixed order across pages. The index (`ownerId`, `updatedAt`) serves it.
- **`GET /api/itineraries/:id` is for the owner only**, public or not: 404 if missing, 403 for another user. Reading someone else's public itinerary is a different route, `GET /api/itineraries/public/:id` (ITN-21).
- **A day's number and date are computed in the mapper**: the number is the position in `days` plus 1, and the date is `startDate` plus the position, added in UTC with `luxon` so a clock change cannot shift it.

## ITN-05: add days and cities

- **A new day goes at the end.** `POST /api/itineraries/:id/days` takes a city and optional notes. The client never sends a number or a date: both follow from the position. Moving a day is ITN-08.
- **The city is checked against the `cities` collection** (400 with the unknown id). The workbook does not ask that the city belongs to one of the itinerary's countries, so that is not checked.
- **Adding a day is one conditional update**: `$push` the day and `$inc` `dayCount`, only where `dayCount` is below 60. Two requests at the same moment cannot pass the limit or leave `dayCount` different from the number of days. When the update matches nothing, the itinerary is full and the answer is 409.
- **The day routes return the whole itinerary with its days**, because one change can affect the numbers and dates of other days.
- **Editing a day changes only the fields that are sent.** Empty notes clear the notes. A day always keeps a city (ITN-09), so the city can be replaced but not removed.
- **A day id that is not in this itinerary gives 404** "Day not found".

## ITN-20: public or private

- **Visibility is a field of `PATCH /api/itineraries/:id`**, as in section 8 of the project description (that route serves ITN-01 and ITN-20). There is no separate publish route.
- **Only `UpdateItineraryDto` has `visibility`.** `CreateItineraryDto` does not, so a new itinerary is always private (ITN-01) and becomes public only by an explicit edit.
- **"Read-only to other users" is the ownership check.** Every route that changes an itinerary goes through `findOwnedOrThrow()`, so another user gets 403 on a public itinerary exactly as on a private one.
- **"Setting Private removes it immediately" needs no extra work.** Nothing is copied when an itinerary is published: public search (ITN-21) will filter on the `visibility` field, so the next search after the change no longer returns it.
