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
