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

## ITN-07: delete a day

- **`DELETE /api/itineraries/:id/days/:dayId` returns the itinerary with its remaining days**, because the days after the deleted one get new numbers and dates. Totals are computed when read, so they change with it. The "after confirmation" step is the app's dialog (Milestone 2).
- **One update with a version check.** The service reads the itinerary, then writes the remaining days and their count in one update that only applies if the itinerary is still at the version it read, and bumps the version. So `dayCount` always equals the number of days, a day added at the same moment is never lost, and the same day deleted twice at once gives 200 and then 404 or 409.
- **Adding a day bumps the version too (ITN-05)**, so a delete that read the itinerary before that day existed is refused instead of dropping it.
- **A change by position that loses the race answers 409** "The itinerary was changed by another request". `saveOrConflict()` turns the Mongoose `VersionError` into that answer, and the day edit (ITN-05) uses it now.
- **Everything inside the day goes with it**: its activities, budget entries and transport costs. When activity images exist (ITN-12), deleting a day must also delete their files.
- **The e2e tests share `test/support/itinerary-fixture.ts`**, which adds a test country and two test cities, makes users with a live session, and deletes everything by id at the end.

## ITN-08: move a day

- **`PATCH /api/itineraries/:id/days/reorder` takes `{ dayId, position }`**: the day to move and its new day number (1 is the first day). The days in between shift by one. It returns the itinerary in the new order, since every number, date and city group can change.
- **The route is declared before `PATCH :id/days/:dayId`**, or Nest would read `reorder` as a day id.
- **A position after the last day answers 400** with the allowed range. Moving a day to where it already is changes nothing and writes nothing.
- **Same versioned write as ITN-07.** `writeDays()` replaces the days in one update that only applies at the version that was read. A move and a delete at the same moment can each apply or answer 409, but never half apply, and `dayCount` always equals the number of days. This relies on MongoDB applying a single-document update atomically.

## ITN-09: city groups

- **Every day has a city.** ITN-05 already requires `cityId` on a day and checks it against the city list; this issue relies on that.
- **`cityGroups` is part of the itinerary detail** (`GET /api/itineraries/:id` and every route that returns the itinerary with its days). Consecutive days in the same city form one group with `firstDayNumber`, `lastDayNumber`, `startDate`, `endDate`, `dayCount` and `budgetSubtotal`. A city visited twice with other days in between gives two groups.
- **Computed when read, never stored**, so adding, editing, moving (ITN-08) or deleting (ITN-07) a day regroups at once. Hotel search for a group (ITN-25) can use `startDate` and the day after `endDate` as check-in and check-out.
- **The subtotal is one amount per currency.** It adds activity costs (ITN-10), budget entries (ITN-14) and transport costs (ITN-16) of the group's days, sorted by currency code. Entries keep their own currency; one total in the user's currency comes with ITN-18. An activity without a cost adds nothing.

## ITN-10: activities per day

- **Routes as in section 8 of the project description**: `POST /api/itineraries/:id/days/:dayId/activities` adds one; `PATCH /api/activities/:id` and `DELETE /api/activities/:id` work by the activity's own id. All are for the owner only and return the itinerary with its days, so the day list and the city group subtotals (ITN-09) are always current.
- **`ActivitiesService` and `ActivitiesController` are separate files**, so the itinerary service does not grow with every embedded list. They reuse `findOwnedOrThrow()`, `findDayOrThrow()`, `assertCurrencySupported()` and `saveOrConflict()` from `ItinerariesService`.
- **An activity is found by its id inside the days** (`days.activities._id`): 404 if no itinerary has it, then 403 if the itinerary is not the caller's.
- **A cost and its currency go together.** The DTO refuses one without the other, and an edit that would leave only one answers 400. The currency must be supported: one of the currency codes of the seeded countries (GEN-12). A cost is whole minor units, 0 or more. An activity without a cost adds nothing to the budget; its cost counts under Activities (ITN-14).
- **Limits not in the workbook**: name at most 100 characters, description at most 1000, so one itinerary document stays small.
- **`null` in an edit answers 400** (`assertNoNullFields`), as the hotel edit does (HTL-01). An empty description or time removes it. A cost cannot be removed once set; setting it to 0 makes it add nothing.
- **Deleting writes a new list for the day** instead of a `$pull`, and every change goes through `saveOrConflict()`, so a change that raced with a delete or a move of a day (ITN-07, ITN-08) answers 409 instead of editing the wrong day.
- **Images (ITN-12) are not in the response yet.** `images` is in the schema; ITN-12 adds the routes and the URLs, and must delete an activity's files when the activity or its day is deleted.

## ITN-16: transport costs

- **Routes as in section 8**: `POST /api/itineraries/:id/transport-costs` with the day in the body (`dayId`), then `PATCH` and `DELETE /api/transport-costs/:id`. Owner only; each returns the itinerary with its days.
- **The fields the workbook lists**: mode, from-city, to-city, amount, currency and day. `mode` is free text up to 50 characters (train, bus, flight...), because the workbook gives no fixed list.
- **Both cities come from the city list and must differ**, since this is intercity transport (ITN-14 calls these "intercity transport entries"). An edit that changes one city is checked against the other one it keeps.
- **A transport cost belongs to one day**, so it counts in that day's city group subtotal (ITN-09) and leaves with the day if the day is deleted (ITN-07). `PATCH` with a new `dayId` moves it to that day of the same itinerary and keeps its id.
- **Amount and currency follow the money rules**: whole minor units, 0 or more, in a supported currency. `null` in an edit answers 400, as for activities.
- **Same design as activities (ITN-10)**: a separate `TransportCostsService` and `TransportCostsController`, found by id inside the days (404, then 403), saved through `saveOrConflict()`.

## ITN-21: search, view and clone public itineraries

- **Routes**: `GET /api/itineraries/public/search` and `GET /api/itineraries/public/:id` are open to guests; `POST /api/itineraries/:id/clone` needs a login. The two read routes sit under `/api/itineraries/public/`, the only public part of `/api/itineraries` that `test/guest-access.e2e-spec.ts` allows. `public/search` is declared before `public/:id`, or `search` would be read as an id.
- **Publicly visible means three things**: public (ITN-20), not hidden by an admin (`moderation`, GEN-10) and the author's account not deactivated (`authorDeactivated`, ACC-12). `PUBLICLY_VISIBLE` holds this filter once for search, view and clone. Anything else answers 404, so a private itinerary is never revealed, not even that it exists.
- **The keyword (`q`)** matches part of the title, in any case, or a country (its code or part of its name) or the name of a city on any day. It is matched as plain text (`escapeRegExp`), never as a pattern a caller could abuse. Filters: `minDays` and `maxDays` (1 to 60) on `dayCount`, `country` (code) and `city` (city id). `minDays` above `maxDays` answers 400.
- **Results are lightweight**: the list fields of ITN-03 plus `author { id, name }`, without the days (`.select('-days')`), most recently updated first, paginated. Opening one gives the full detail (days, activities, transport costs, city groups) plus the author. An author whose account is gone shows as "Unknown author".
- **A clone is a new private itinerary of the caller** with every day, activity, budget entry and transport cost copied with new ids. It shares nothing with the original, so editing or deleting either one leaves the other alone. `clonedFrom { itineraryId, authorId, authorName }` credits the author; the name is kept at clone time, so the credit stays if the original is deleted later.
- **Cloned activities keep the same image filenames** (ITN-12). ITN-12 must therefore not delete an image file while another activity still uses it, or must copy the files on clone.
