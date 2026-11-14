# Reference Data

The reference module provides read-only data used by the travel platform, such as airports, cities, and countries.

## Airport list design decisions

- The airport endpoint is public because airport data is read-only reference data.
- Airport results are paginated using the shared `PaginationQueryDto`.
- The API response exposes only the fields required by the public contract.
- City and country names are resolved from their reference collections instead of exposing internal IDs.
- The airport service performs batched `$in` queries for cities and countries to avoid an N+1 query pattern.
- Missing city or country references result in a `404 Not Found` response.
- Airports are sorted by their airport code (`_id`) for deterministic pagination.
