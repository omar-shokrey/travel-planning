import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';

/**
 * ACC-02: the route books something, so an account whose email is not
 * verified (`emailVerified: false`) gets 403 "Verify your email address
 * before booking" (`JwtAuthGuard`). It is on the routes that start a booking
 * or hold seats or rooms: `POST /api/flight-bookings`,
 * `POST /api/flight-bookings/hold` and `POST /api/hotel-bookings`. It can be
 * set on a handler or on a controller; it changes nothing for a `@Public()`
 * route.
 */
export const RequireVerifiedEmail = () =>
  SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
