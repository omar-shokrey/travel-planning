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
