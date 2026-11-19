# Payments module

Payments, refunds and the provider policies shown before payment. Built so far: the policy display and acceptance (PAY-02), the Stripe payment with its webhook (PAY-01) and the refunds through Stripe (PAY-03).

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
- **Who confirms the booking (FLT-23, HTL-17).** The confirmation (status `confirmed`, held seats to booked, the reference, the notification) belongs to those two issues. This module only calls a small contract, `BookingPaymentHandler.confirmPaid(bookingId, now)` (`booking-payment-handler.ts`). `PaymentsModule` looks for `confirmPaid` on `FlightBookingsService` and `HotelBookingsService`; until an issue adds it, the payment is marked `succeeded`, an error is logged and the webhook answers **503 without remembering the event**, so Stripe sends it again (for up to 3 days) instead of the confirmation being lost; the booking stays `pending_payment`. `confirmPaid` must be idempotent, must confirm only with an update that matches `status: pending_payment` and `holdExpiresAt > now` (see the booking READMEs), and returns `false` when the hold had ended: that payment is late, never confirmed, and is refunded in full (PAY-03, see "Refunds").

### When the hold ends

- `PaymentExpiryService` runs every minute (`@Cron(EVERY_MINUTE)`, next to the booking expiry jobs) and cancels the PaymentIntent of every open payment (`requires_payment` or `failed`) whose `holdExpiresAt` has passed, at most 100 per run. `holdExpiresAt` is a copy of the booking's hold stored on the payment, so the job does not read the booking. Stripe is called first. If Stripe refuses, the job reads the PaymentIntent back: if it is already `canceled` (an earlier run cancelled it but could not mark the payment) the payment is marked `cancelled` now, so it is not tried again every minute; otherwise (the payment just succeeded) the payment is left alone and the webhook reports the result. Only after Stripe cancelled does the payment become `cancelled`, with an update that matches only a payment that is still open.
- A card charged in the last seconds of the hold can succeed after the hold ended. The webhook then finds the booking no longer confirmable and refunds the payment in full (PAY-03, `late_payment`).

### Settings

`STRIPE_SECRET_KEY` (only a test key, `sk_test_` or `rk_test_`, is accepted: a live key stops the app at startup) and `STRIPE_WEBHOOK_SECRET` (`whsec_`, from `stripe listen --forward-to localhost:3001/api/payments/webhook`). Both may stay empty: the app starts and the payment routes answer 503.

## Refunds (PAY-03)

PAY-03: "For every cancellation with a positive refund amount (user cancellations per the provider's tiers; provider-initiated cancellations at 100%), the system shall issue a refund through the Stripe Refunds API, record it, and show its status (Pending, Refunded, Failed) on the booking details. The user receives an in-app notification."

| Route                  | Requirement | Access                        |
| ---------------------- | ----------- | ----------------------------- |
| `GET /api/refunds/:id` | PAY-03      | Registered user (role `user`) |

### Layout: no import cycle

- **`RefundsService` is its own small module, `RefundsModule` (`refunds/`), with no booking import.** The cancellations (FLT-26, HTL-21, FLT-06) live in the booking modules and must call the refund; the payments module already imports the booking modules (to confirm a paid booking). If refunds lived in `PaymentsModule`, the two would import each other. So `RefundsModule` imports only the `Payment` and `Refund` models, `NotificationsModule` and `StripeModule`, never `FlightBookingsModule`, `HotelBookingsModule` or `PaymentsModule`; the booking modules will import `RefundsModule`. This is the contract of the development plan, section 15. `PaymentsModule` imports `RefundsModule` for the late-payment refund; `app.module.ts` is unchanged.
- **One Stripe gateway.** `StripeModule` (`stripe.module.ts`) provides and exports `StripeGateway`; `PaymentsModule` and `RefundsModule` both import it, so there is one instance (a test that replaces a gateway method replaces it everywhere). `stripe.gateway.ts` is still the only file that imports the Stripe SDK.

### The contract: `RefundsService.refund(...)`

- **Input:** `{ bookingType, bookingId, refundPercent, reason }`. The caller computes the percent: a user cancellation uses `refundPercentFor(tiers, daysRemaining)` (`common/cancellation-tiers.ts`) with the tiers copied into the booking; a provider cancellation passes 100. This service never reads a booking and never reads tiers. `reason` is `user_cancellation`, `flight_cancelled` or `late_payment` (`RefundReason`).
- **The payment:** the booking's payment with status `succeeded`, or 404 "Payment not found" (the callers only cancel a confirmed booking, which always has one).
- **The amount:** `Math.round(payment.amount × refundPercent / 100)`, in whole minor units, never more than the payment. The currency, the payment, the owner and the amount come from the payment, never from the caller.
- **Only a positive refund:** 0%, or an amount that rounds to 0, creates nothing, sends nothing, notifies nobody and returns `null`.
- **Recorded first, then sent.** The refund is inserted as `pending`, then sent with `stripe.refunds.create({ payment_intent, amount, metadata }, { idempotencyKey: 'refund-<type>-<bookingId>' })`, through the PaymentIntent (no card data anywhere). On success one conditional update stores `stripeRefundId` and the status (it matches only a refund without a Stripe id yet).
- **Idempotent per booking.** A booking has at most one refund (unique `bookingType` + `bookingId`): a second call, or two at the same moment, returns the first refund unchanged, so a retried cancellation never refunds twice. The idempotency key does the same at Stripe.
- **It never throws for Stripe trouble.** If Stripe is down (502) or not configured (503), the error is logged (our message only, never the Stripe object or a key) and the refund stays `pending` without a Stripe id: the cancellation goes on while the money is on its way, and the recovery job sends it later. Other errors (the database) are thrown.
- **Notification:** after the refund is recorded, the owner gets an in-app notification of type `refund`, linked to the flight or hotel booking ("Your refund of 125.50 USD for your flight booking is pending."). A late payment says "Your payment arrived after your booking hold ended, so it is being refunded in full (125.50 USD)." The amount is shown in major units by a small pure formatter (`refund-messages.ts`).
- **Returns** the refund (`RefundResponseDto`), or `null`.

### Statuses and the webhook

- **`pending`, `refunded`, `failed`** (`RefundStatus`). Stripe's status is mapped by one pure function, `refundStatusOf`: `succeeded` is refunded; `failed` and `canceled` are failed; `pending`, `requires_action` and anything unknown stay pending, so an unknown status never claims the money arrived.
- **The webhook** (`POST /api/payments/webhook`) also handles `refund.created`, `refund.updated` and `refund.failed`. Stripe sends no `refund.succeeded`: a success arrives as `refund.updated` with status `succeeded`. The refund is found by its `stripeRefundId` and moved with a conditional update that only goes forward (`pending` to `refunded` or `failed`, never out of a final status); the owner gets a second notification only when that update really changed the refund, so a refund that was already `refunded` when Stripe answered is notified once. An event for an unknown refund id is logged and ignored (and remembered like any other event).
- **A failed refund stays `failed`.** Stripe keeps the money in our balance; this issue does not retry it. The team arranges the refund another way.

### The late payment

A card charged in the last seconds of a hold can succeed after the hold ended (PAY-01). When `confirmPaid` returns `false`, the webhook calls `refund({ bookingType, bookingId, refundPercent: 100, reason: late_payment })`. A repeated event is harmless because `refund()` is idempotent per booking. An unexpected error from `refund()` (the database) makes the webhook answer 500 without remembering the event, so Stripe sends it again. The other two branches (an amount that does not match, a payment already cancelled) are unchanged.

### The recovery job

`RefundRecoveryService` runs every 5 minutes. It sends again the refunds that are `pending`, have no `stripeRefundId`, were created more than 1 minute ago (younger ones are still being sent by their own request) and less than 12 hours ago, at most 50 per run, oldest first; one failure does not stop the others. **The 12-hour limit:** Stripe keeps an idempotency key for 24 hours, so a retry inside that window can never create a second Stripe refund. Older refunds are never sent automatically: each run logs how many there are as an error, for the team to check by hand. When Stripe's answer settles a resent refund, the owner is notified.

### Showing the status

- **`GET /api/refunds/:id`** (`RefundsController`): the owner's refund (`RefundResponseDto`: id, booking type and id, payment id, amount, currency, percent, reason, status, `stripeRefundId` or `null`, timestamps; never the owner id). Someone else's refund or a missing one is 404 "Refund not found" (ACC-11); a bad id 400; guests 401; administrators and moderators 403. There is no route that creates a refund: a refund only comes from a cancellation or a late payment, so a client never sends an amount or a status.
- **On the booking details:** `RefundsService.findSummaryByBooking(bookingType, bookingId)` returns `{ id, status, amount, currency, refundPercent }` (`RefundSummaryDto`) or `null`. The booking-details routes do not exist yet (FLT-25, HTL-20 to HTL-22): this method is the hook they embed to show the status, as PAY-03 asks.

### What later issues do

- **FLT-26** (user cancels a flight booking), **HTL-21** (user cancels a hotel reservation) and **FLT-06** (an airline cancels a flight, 100% for every confirmed booking): import `RefundsModule`, cancel the booking, then call `RefundsService.refund(...)` with the percent they computed. A `null` answer means nothing was refundable.
- **FLT-25** and the hotel booking details embed `findSummaryByBooking`.
- **Not in the spec yet** (for a shared-layer PR): the `late_payment` reason and the `currency` field of `REFUND`.

## Tests

`dto/booking-path.dto.spec.ts` and `dto/accept-policies.dto.spec.ts` (through the global pipe options), `mappers/booking-policies.mapper.spec.ts` (both shapes, nulls, tier order, `Z` dates, no ids), `booking-policies.service.spec.ts` (both types, first and repeated acceptance, expired, not pending, another user's booking, the race, `findPayableOrThrow`), `booking-policies.controller.spec.ts` (roles, 200) and `test/booking-policies.e2e-spec.ts` (on the `-test` database: a real flight hold and inserted hotel reservations, both routes, every 400, 401, 403, 404 and 409, and Swagger).

PAY-01: `dto/create-payment.dto.spec.ts`, `mappers/payment.mapper.spec.ts`, `stripe.gateway.spec.ts` (the Stripe SDK replaced: the exact PaymentIntent request, 503 without keys, 502 on a Stripe error, the signature check), `payments.service.spec.ts` (amount from the booking, nothing saved or sent to Stripe when the booking is not payable, the same intent twice, the unique-index race, every retry case), `stripe-webhook.service.spec.ts` (signature, repeated events, success with the amount check and the confirmation seam, failure, cancellation, ignored events), `payment-expiry.service.spec.ts`, `booking-payment-handler.spec.ts`, the two controller specs (roles, public webhook, status codes) and `test/payments.e2e-spec.ts` (on the `-test` database: a real flight hold, accepted policies and the payment routes with the three Stripe calls replaced, a webhook signed with the real signature check, the retry, a repeated event, the expiry job and Swagger).

PAY-03: `refunds/refund-status.spec.ts` (every Stripe status, an unknown one and none), `refunds/refund-messages.spec.ts` (money in major units, the text of each status and of a late payment), `refunds/models/refund.schema.spec.ts`, `refunds/mappers/refund.mapper.spec.ts`, the refund cases of `stripe.gateway.spec.ts` (the exact `refunds.create` request with the idempotency key, 502, 503, the three refund events, payment events unchanged), `refunds/refunds.service.spec.ts` (amounts and rounding, 0% and a zero amount, no payment, fields from the payment, Stripe success, 502 and 503 leaving it pending, a second call and the unique-index race, the notifications, `findSummaryByBooking`, `findOwned`, the webhook status moves, `resubmit`), `refunds/refunds.controller.spec.ts` (roles, 404, no create route), the refund cases of `stripe-webhook.service.spec.ts` (refund events, the late-payment refund, 500 on an unexpected error, other branches unchanged), `refunds/refund-recovery.service.spec.ts` (the age window, the batch, one failure, the 12-hour report) and `test/refunds.e2e-spec.ts` (on the `-test` database, with `createRefund` replaced: the route, `refund()`, a signed refund event, a late payment and the notification).
