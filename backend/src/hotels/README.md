# Hotels

The hotels module owns the `hotels` collection. `HotelsService` creates profiles
and lets a moderator update only the hotel in their user assignment. It reads
cities from `ReferenceModule` and copies each city's country code into the
hotel, so callers cannot choose a mismatched country.

Hotel photos use `UploadsService`; the hotel stores only generated filenames.
Uploads use a conditional photo-count update to prevent concurrent requests
from exceeding the five-photo limit. A removed filename is deleted from the
hotel before its file is removed.

## Hotel details (HTL-02)

- `GET /api/hotels/:id` is public: guests and users open the hotel page without login.
- It lives in its own `HotelDetailsController` and `HotelDetailsService`, so it does not collide with the profile and search work in the same module. The controller is registered last in `HotelsModule`: a controller with a fixed path such as `GET /hotels/search` must be matched before `GET /hotels/:id`, or "search" would be read as an id and answer 400.
- Only an active hotel is shown. A deactivated hotel answers 404, the same as a missing one, because ACC-15 hides it from the public.
- The response is the `HotelResponseDto` of HTL-01: profile, photos with their URLs, amenities, `averageRating` and `ratingCount`.
- The other parts of the hotel page come from the issues that own their data: check-in and check-out times and the cancellation policy are added to this response by HTL-09 and HTL-10, the reviews are read from `GET /api/hotels/:id/reviews` (HTL-24), and the rooms free for chosen dates from `GET /api/hotels/:id/rooms/available` (HTL-15).

## Check-in and check-out times (HTL-09)

- The policies are embedded in the hotel document as `policy` (`HotelPolicy` schema), as in the data model of the spec, because they belong to exactly one hotel.
- `checkInTime` and `checkOutTime` are `HH:mm` strings on the 24-hour clock, local to the hotel. They are a time without a date, so they are never stored as a `Date` and no time zone can shift them.
- `PUT /api/hotels/:id/policies` is for the hotel moderator assigned to that hotel. `PUT` replaces the policies as a whole, so both times are required. HTL-10 adds the cancellation tiers to the same route.
- There is no rule that check-out is earlier than check-in: they are times on different days of a stay.
- A hotel has no policies until its moderator sets them. The hotel page (`GET /api/hotels/:id`) then shows `policy: null`; no default times are invented.
- The hotel page returns `HotelDetailsResponseDto`: the `HotelResponseDto` of HTL-01 plus `policy`. `HotelResponseDto` and its mapper are unchanged.
- `HotelsService.findManagedEntityOrThrow(hotelId, userId)` is new: it returns the hotel entity after the same "is this the moderator's hotel" check that HTL-01 uses (404 for a missing hotel, 403 for another moderator). The policy service calls it, and the room services of this module can use it too, so the ownership rule lives in one place.

## Cancellation tiers (HTL-10)

- The tiers are embedded in the hotel's `policy` as `cancellationTiers`, as in the data model of the spec. Each tier has `daysBefore` (whole days before check-in, 0 or more) and `refundPercent` (a whole number from 0 to 100).
- They are set with the same `PUT /api/hotels/:id/policies` as the times, because the endpoint table gives HTL-09 and HTL-10 one route. `PUT` replaces the policies as a whole, so `cancellationTiers` is required; an empty list means "no refund".
- Two tiers of one hotel cannot have the same `daysBefore`; the request answers 400. A hotel has at most 10 tiers (`HOTEL_CANCELLATION_TIERS_MAX_COUNT`), a limit I chose because the workbook gives none.
- The tiers are stored and returned with the highest threshold first, whatever order they were sent in.
- `selectRefundPercent(tiers, daysRemaining)` in `cancellation-tiers.ts` is the selection rule of FLT-09: the tier with the highest threshold that does not exceed the days remaining, and 0% if no tier applies. It is a pure function with its own tests, for the cancellation of a reservation (HTL-21) and the refund (PAY-03) to call.
- The percentages are not forced to rise with the threshold. The workbook does not ask for it, and the rule above gives one clear answer for any list.
- The hotel page (`GET /api/hotels/:id`) shows the tiers inside `policy`.
