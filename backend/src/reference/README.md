# Reference module

Seeded, read-only countries, cities, airports and attractions (GEN-12), and the public airport list (FLT-02). The seed program in `backend/src/seed/` writes these collections; this module only reads them.

## FLT-02: airport list

| Route               | Requirement | Access         |
| ------------------- | ----------- | -------------- |
| `GET /api/airports` | FLT-02      | Anyone (guest) |

## Design decisions

- **Public route.** Guests search flights (FLT-11) and need the airports to choose from, so `GET /api/airports` is marked `@Public()`.
- **Read-only.** There is no create, edit or delete route. The list changes only through the CSV files in `docs/requirements/reference-data/` and the seed, which the team leader runs.
- **Paginated like every list (GEN-05)**, sorted by IATA code so the order never changes between pages.
- **The response names the city and the country.** The airport stores only their ids, so the service reads the names of the cities and countries on the page in two queries. A missing name falls back to the id instead of failing the list.
- **The IATA code is `code` in the response.** It is the airport's `_id` in the database (the official id, GEN-12).
- **`AirportsService.findEntityOrThrow(code)` is for other services.** Flight creation (FLT-03) and flight search (FLT-11) accept only airports from this list: they call it with the code the client sent, and an unknown code answers 400. It returns the entity, so it is never used by a controller.
- **The end-to-end tests add their own data.** The test database may hold no reference data (CI starts empty), so `test/airports.e2e-spec.ts` adds one country, one city and two airports with codes that no record uses, and deletes them one by one at the end.
