# Payments module

Payments, refunds and the provider policies shown before payment. Built so far: the policy display and acceptance (PAY-02). The Stripe payment (PAY-01), the webhook and refunds (PAY-03) come later.

The booking modules own the bookings. This module reaches them only through `FlightBookingsService` and `HotelBookingsService` (`findOwnedEntityOrThrow`, `acceptPolicies`), which their modules export. The booking modules never import this module, so there is no cycle.

## Show and accept the provider's policies (PAY-02)

| Route                                          | Requirement | Access                        |
| ---------------------------------------------- | ----------- | ----------------------------- |
| `GET /api/bookings/:type/:id/policies`         | PAY-02      | Registered user (role `user`) |
| `POST /api/bookings/:type/:id/accept-policies` | PAY-02      | Registered user (role `user`) |

- **The path.** `:type` is `flight` or `hotel` (`BookingType`), `:id` the booking id. Both are validated by `BookingPathDto` with `@Param()`: a bad type or id is 400 in the usual error shape.
- **Who may call them.** `@Roles(Role.User)`: guests get 401, administrators and moderators 403. A booking that does not exist **or belongs to another user** is 404 "Booking not found", so a user never learns that someone else's booking exists (ACC-11).
- **What is shown.** For a flight booking, per segment: the airline's cancellation tiers and the baggage rule (`freeBags` and `maxBagKg` of the cabin, `extraBagPrice` with `currency`, `null` when the airline sells no extra bags, and `maxExtraBags`). For a hotel reservation: `checkInTime` and `checkOutTime` (`null` when the hotel set none) and the cancellation tiers. Tiers keep the stored order, highest `daysBefore` first; an empty list means no refund. The response also has `type`, `bookingId`, `status`, `holdExpiresAt` (`null` unless the booking waits for payment) and `policyAcceptedAt` (`null` until accepted), in UTC ending in `Z`. Never the owner id, the airline or hotel id, seat counters or Mongo internals.
- **The policies are the copies in the booking, never the provider's current ones.** A hotel reservation copies its hotel's times and tiers when it is made (HTL-16). A flight booking copies its airline's tiers and extra-bag rule, and the cabin's free allowance, when the seats are held (PAY-02, see the flight-bookings README). So what the user is shown and accepts is exactly what a later refund (FLT-26, HTL-21) uses, whatever the provider changes afterwards. A flight booking saved before the copy existed shows empty tiers, `extraBagPrice` `null`, `maxExtraBags` 0 and `null` free allowance; the live airline is not read for it.
- **The policies can be read in any status**, so the user can look at them again later.
- **The acceptance checkbox is explicit.** The body must be `{ "accepted": true }` (`@Equals(true)`, like the ACC-01 consent): a missing or `false` value is 400 "You must accept the policies to continue", and any other field is 400 (`forbidNonWhitelisted`). A request that forgot the checkbox never counts as an acceptance.
- **One conditional update.** `acceptPolicies` sets `policyAcceptedAt: now` only on the user's own booking that is `pending_payment`, whose `holdExpiresAt > now` and that was not accepted before. When it matches nothing, one read tells why: 404 (missing or not theirs); **200 with the first timestamp unchanged** when it was already accepted (accepting twice is harmless and never moves the time); 409 "This booking is not waiting for payment" (confirmed, expired, completed or cancelled); 409 "The hold has expired. Start the booking again"; and, if the booking changed between the update and the read, 409 "The booking was changed by another request. Try again." Nothing is stored in any error case.
- **Acceptance only while the hold is live.** Accepting a booking whose seats or rooms may already be released would let a payment start on nothing.
- **The POST answers 200**, also when the policies were already accepted, with the same body as the GET.

## Rule for PAY-01

**Call `BookingPoliciesService.findPayableOrThrow(type, id, userId, now)` before creating a PaymentIntent; never charge a booking whose policies are not accepted or whose hold has ended.** It returns `{ type, bookingId, total, currency, holdExpiresAt }` only for the user's own booking that is `pending_payment`, has a live hold and has `policyAcceptedAt` set. Otherwise it answers 404, 409 "This booking is not waiting for payment", 409 "The hold has expired. Start the booking again" or 409 "Accept the provider's policies before paying". `PaymentsModule` exports `BookingPoliciesService`; no route uses this method yet.

## Tests

`dto/booking-path.dto.spec.ts` and `dto/accept-policies.dto.spec.ts` (through the global pipe options), `mappers/booking-policies.mapper.spec.ts` (both shapes, nulls, tier order, `Z` dates, no ids), `booking-policies.service.spec.ts` (both types, first and repeated acceptance, expired, not pending, another user's booking, the race, `findPayableOrThrow`), `booking-policies.controller.spec.ts` (roles, 200) and `test/booking-policies.e2e-spec.ts` (on the `-test` database: a real flight hold and inserted hotel reservations, both routes, every 400, 401, 403, 404 and 409, and Swagger).
