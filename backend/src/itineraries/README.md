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
