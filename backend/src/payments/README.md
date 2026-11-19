# Payments module

Payments, refunds and the provider policies shown before payment. Built so far: the policy display and acceptance (PAY-02) and the Stripe payment with its webhook (PAY-01). Refunds (PAY-03) come later.

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

## Pay a booking with Stripe (PAY-01)

| Route                          | Requirement | Access                                    |
| ------------------------------ | ----------- | ----------------------------------------- |
| `POST /api/payments`           | PAY-01      | Registered user (role `user`)             |
| `POST /api/payments/:id/retry` | PAY-01      | Registered user (role `user`)             |
| `GET /api/payments/:id`        | PAY-01      | Registered user (role `user`)             |
| `POST /api/payments/webhook`   | PAY-01      | Public: the Stripe signature is the login |

- **Card details never reach the backend.** `POST /api/payments` creates a Stripe PaymentIntent (test mode, `card` only) and answers with its `clientSecret`; the frontend confirms the payment with Stripe Elements. Only the Stripe payment id, the amount, the currency and the status are stored (collection `payments`); the client secret is read from Stripe whenever it is needed and is never stored or logged. `StripeGateway` (`stripe.gateway.ts`) is the only file that imports the Stripe SDK.
- **The body names the booking and nothing else** (`bookingType`, `bookingId`; `CreatePaymentDto`). The amount and currency are the booking's `total` and `currency`, the owner is the logged-in user. Any other field is 400.
- **The rule from PAY-02 is called first**: `BookingPoliciesService.findPayableOrThrow` gives 404 (not the user's booking) or 409 (not `pending_payment`, hold over, policies not accepted) before Stripe is called.
- **One payment per booking.** Unique index on (`bookingType`, `bookingId`) and on `stripePaymentIntentId`. Asking again while the payment waits for the card returns the same PaymentIntent (the Stripe idempotency key is `payment-<type>-<bookingId>` too, so two requests at the same moment get one intent); 409 once it succeeded, failed (use the retry) or was cancelled.
- **Retry** (`POST /api/payments/:id/retry`): after a failure the user may retry until the hold ends. A `failed` payment goes back to `requires_payment` with a conditional update and the same PaymentIntent is returned; the booking must still be payable. A payment that succeeded or was cancelled, or whose PaymentIntent Stripe reports as succeeded or canceled, gives 409.
- **`GET /api/payments/:id`** shows the owner's payment (404 for someone else's, ACC-11), without the client secret.
- **Statuses**: `requires_payment`, `succeeded`, `failed`, `cancelled` (`PaymentStatus`). They only move forward by conditional updates: `failed` only from `requires_payment`; `cancelled` from `requires_payment` or `failed`; `succeeded` from `requires_payment` or `failed`.

### The webhook decides, not the browser

- `POST /api/payments/webhook` is `@Public()`: Stripe has no login. The signature (`Stripe-Signature`) is checked against the **raw** request body with `STRIPE_WEBHOOK_SECRET` (`main.ts` and the e2e fixture start Nest with `rawBody: true`). A missing or wrong signature is 400 and nothing changes; no webhook secret is 503.
- `payment_intent.succeeded`: the amount received and the currency must equal the stored payment (otherwise it is logged and not confirmed). The payment becomes `succeeded` and the booking module is asked to confirm the booking. `payment_intent.payment_failed` moves the payment to `failed`. `payment_intent.canceled` moves it to `cancelled`. Every other event is accepted and ignored.
- **Repeated events are harmless.** The event id is stored in `stripe_events` (TTL 30 days) **after** the event was handled, and an id that is already there is ignored. Every step is idempotent, so if the app crashes in between, Stripe's retry handles the event again; a failure while handling answers 500, so Stripe retries too.
- **Who confirms the booking (FLT-23, HTL-17).** The confirmation (status `confirmed`, held seats to booked, the reference, the notification) belongs to those two issues. This module only calls a small contract, `BookingPaymentHandler.confirmPaid(bookingId, now)` (`booking-payment-handler.ts`). `PaymentsModule` looks for `confirmPaid` on `FlightBookingsService` and `HotelBookingsService`; until an issue adds it, the payment is marked `succeeded`, an error is logged and the webhook answers **503 without remembering the event**, so Stripe sends it again (for up to 3 days) instead of the confirmation being lost; the booking stays `pending_payment`. `confirmPaid` must be idempotent, must confirm only with an update that matches `status: pending_payment` and `holdExpiresAt > now` (see the booking READMEs), and returns `false` when the hold had ended: that payment is late and is logged for the refund (PAY-03), never confirmed.

### When the hold ends

- `PaymentExpiryService` runs every minute (`@Cron(EVERY_MINUTE)`, next to the booking expiry jobs) and cancels the PaymentIntent of every open payment (`requires_payment` or `failed`) whose `holdExpiresAt` has passed, at most 100 per run. `holdExpiresAt` is a copy of the booking's hold stored on the payment, so the job does not read the booking. Stripe is called first. If Stripe refuses, the job reads the PaymentIntent back: if it is already `canceled` (an earlier run cancelled it but could not mark the payment) the payment is marked `cancelled` now, so it is not tried again every minute; otherwise (the payment just succeeded) the payment is left alone and the webhook reports the result. Only after Stripe cancelled does the payment become `cancelled`, with an update that matches only a payment that is still open.
- A card charged in the last seconds of the hold can succeed after the hold ended. The webhook then finds the booking no longer confirmable and logs it: the refund is PAY-03.

### Settings

`STRIPE_SECRET_KEY` (only a test key, `sk_test_` or `rk_test_`, is accepted: a live key stops the app at startup) and `STRIPE_WEBHOOK_SECRET` (`whsec_`, from `stripe listen --forward-to localhost:3001/api/payments/webhook`). Both may stay empty: the app starts and the payment routes answer 503.

## Tests

`dto/booking-path.dto.spec.ts` and `dto/accept-policies.dto.spec.ts` (through the global pipe options), `mappers/booking-policies.mapper.spec.ts` (both shapes, nulls, tier order, `Z` dates, no ids), `booking-policies.service.spec.ts` (both types, first and repeated acceptance, expired, not pending, another user's booking, the race, `findPayableOrThrow`), `booking-policies.controller.spec.ts` (roles, 200) and `test/booking-policies.e2e-spec.ts` (on the `-test` database: a real flight hold and inserted hotel reservations, both routes, every 400, 401, 403, 404 and 409, and Swagger).

PAY-01: `dto/create-payment.dto.spec.ts`, `mappers/payment.mapper.spec.ts`, `stripe.gateway.spec.ts` (the Stripe SDK replaced: the exact PaymentIntent request, 503 without keys, 502 on a Stripe error, the signature check), `payments.service.spec.ts` (amount from the booking, nothing saved or sent to Stripe when the booking is not payable, the same intent twice, the unique-index race, every retry case), `stripe-webhook.service.spec.ts` (signature, repeated events, success with the amount check and the confirmation seam, failure, cancellation, ignored events), `payment-expiry.service.spec.ts`, `booking-payment-handler.spec.ts`, the two controller specs (roles, public webhook, status codes) and `test/payments.e2e-spec.ts` (on the `-test` database: a real flight hold, accepted policies and the payment routes with the three Stripe calls replaced, a webhook signed with the real signature check, the retry, a repeated event, the expiry job and Swagger).
