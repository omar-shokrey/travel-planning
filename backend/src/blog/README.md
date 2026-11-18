# Blog

## Public Author Page

`GET /api/authors/:id` exposes a public author page for registered users and guests.

The page includes:

- Author id
- Author name
- Join date
- Published and visible blog posts
- Public itineraries provided by ITN-20

### Author visibility

Only users with role `user` and status other than `deactivated` are publicly visible.

Unknown users, administrators, moderators, and deactivated users return:

`404 Author not found`

Suspended users remain publicly visible.

### Pagination

Posts and itineraries are paginated independently.

Supported query parameters:

- `postsPage` � default `1`, minimum `1`
- `postsLimit` � default `10`, maximum `50`
- `itinerariesPage` � default `1`, minimum `1`
- `itinerariesLimit` � default `10`, maximum `50`

Unknown query parameters are rejected with `400 Bad Request`.

### Dependencies

The public itinerary portion of the author page depends on **ITN-20** (`Public itineraries by author`). BLG-12 consumes the public itinerary functionality provided by ITN-20 rather than implementing a separate itinerary data source.
