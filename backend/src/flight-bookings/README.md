# Flight bookings module

Flight bookings (`flight_bookings`). The flights and their cabin seat counters belong to the flights module, and this module reaches them only through `FlightSeatHoldsService` (see "Seat holds (FLT-22)" in the flights README).

## Hold seats for payment (FLT-22)

| Route                            | Requirement            | Access                        |
| -------------------------------- | ---------------------- | ----------------------------- |
| `POST /api/flight-bookings/hold` | FLT-22 (GEN-11 status) | Registered user (role `user`) |

- **Who may call it.** `@Roles(Role.User)`: guests get 401, administrators and moderators 403.
- **The body** is `flightId`, `cabin` (`economy`, `premium_economy`, `business`, `first`) and `passengers: { adults, children, infants }` (`HoldFlightBookingDto`). All three counts are required and whole. The client never sends a price, status, hold time, owner, seat count or reference: `forbidNonWhitelisted` answers 400 for any of them, also inside `passengers`.
- **Passenger rules.** At least one adult, and no more infants than adults (FLT-12(b)). Adults and children take a seat, infants do not (FLT-12), so `seatsReserved = adults + children`.
- **At most 9 seats per booking** (`FLIGHT_BOOKING_SEATS_MAX`). The workbook sets no maximum; 9 is our limit, the usual airline limit for one booking, and it keeps one request from emptying a cabin. A booking above it gets 400 on `passengers.children` (or on `passengers.adults` when adults alone exceed it).
- **This call is "proceeds to payment".** Section 8 of the project description has `POST /api/flight-bookings` for FLT-19 and FLT-21 and `POST /api/flight-bookings/hold` for FLT-22. Here `/hold` is the step where the user proceeds to payment: FLT-19 will add the passengers' details and the baggage to this same request body, and FLT-21 shows the summary before it. **To confirm with the FLT-19/FLT-21 owner and Omar before they start.**
- **Hold first, save after.** One `now` per request. `FlightSeatHoldsService.hold` reserves the seats with one conditional update on the flight (scheduled at `now`, cabin present, enough seats left) and returns the flight as the update left it. The booking is then saved as `pending_payment` with `holdExpiresAt = now + 10 minutes` (`FLIGHT_BOOKING_HOLD_MINUTES`) and a pre-made `_id`. If saving fails, the seats are released and the save error is rethrown, so nothing stays held for a booking that does not exist. If that release fails too, it is logged and the counter stays one booking too high until recomputed.
- **Why the order is hold then save.** Saving first would leave a `pending_payment` booking without seats when the hold is refused; holding first leaves at most a counter to give back, which the service does at once.
- **No transaction.** The CI database is a single MongoDB server, which has none, and none is needed: the seat rule is the filter of one update on one flight document, which MongoDB applies atomically. The e2e test sends 6 one-seat requests at once for a 3-seat cabin and gets exactly three 201 and three 409, `heldSeats` 3 and 3 bookings.
- **Price.** `fare` is the cabin price read from the flight document **returned by the same update** that held the seats, not from an earlier read, so a price edit at the same moment (FLT-05) cannot give a total that differs from the price the seats were taken at. `fareTotal = fare × seats + infants × Math.round(fare × 10 / 100)`: an infant pays 10% of the fare (FLT-12), rounded to a whole minor unit. `total = fareTotal` until baggage (FLT-19). Money is whole minor units of `PLATFORM_CURRENCY` (USD, PAY-04).
- **Errors.** 404 "Flight not found" (also for a flight of a deactivated airline, ACC-15: a deactivated provider is hidden and not bookable), 409 "This flight can no longer be booked" (cancelled or departed, or its departure time has passed, FLT-30), 404 "This flight has no business cabin" (the cabin sent is named), 409 "Not enough seats left in this cabin". Nothing is held in any error case.
- **Response** (`FlightBookingResponseDto`, `toFlightBookingResponse`): `id`, `status`, `holdExpiresAt` (UTC, ending in `Z`), `currency`, `fareTotal`, `total`, `segments: [{ flightId, cabin, fare, seatsReserved }]`, `passengerCounts`, `createdAt`. Never the owner id, the segment's airline id, the flight's seat counters or Mongo internals. `reference` is left out until the payment gives one.

## The booking document

- `FlightBooking` follows `FLIGHT_BOOKING` of the data model with only what FLT-22 needs: `userId`, `status` (`FlightBookingStatus`, the five GEN-11 values shared with hotel reservations), `holdExpiresAt` (required while `pending_payment`), `currency`, `fareTotal`, `total`, `segments`, `passengerCounts`, `reference` and the timestamps. Money fields are validated as whole numbers of 0 or more (`fare` at least 1, like the cabin price).
- `segments` holds exactly one segment now (`flightId`, `airlineId`, `cabin`, `fare`, `seatsReserved`); the schema allows two so FLT-12 can add the return flight without a change. The flight times are always read from the flight.
- `passengerCounts` keeps how many adults, children and infants the booking is for, because infants have no seat but pay, and FLT-19 must check its passenger list against it.
- `reference` stays empty until FLT-23 sets it, so its unique index is `sparse`.
- Indexes from the spec: unique sparse `reference`; (`userId`, `status`) for "my bookings" (FLT-25); `segments.flightId` for the bookings of a flight (FLT-06, FLT-29); (`status`, `holdExpiresAt`) for the expiry job.

## Expiry of unpaid holds (FLT-22, GEN-11)

- `FlightBookingExpiryService` runs every minute (`@Cron(CronExpression.EVERY_MINUTE)`, with `ScheduleModule.forRoot()` registered once in `AppModule` for both flight and hotel holds). The scheduled method catches and logs every error: a job must never crash the app.
- `expireDueHolds(now)` reads the `pending_payment` bookings whose `holdExpiresAt <= now`, oldest first, at most 100 per run (`FLIGHT_BOOKING_EXPIRY_BATCH_SIZE`), through the (`status`, `holdExpiresAt`) index. For each one it sets `status: expired` with an update that matches `{ _id, status: pending_payment, holdExpiresAt: { $lte: now } }`, and **only when that update matched** it releases the seats of each segment through `FlightSeatHoldsService.release`.
- **Expire first, then release.** A booking confirmed in between does not match, so its seats are never released; a booking another run already expired does not match, so its seats are never released twice. A booking can therefore never be both confirmed and released. If a release fails after the expire, the error is logged and `heldSeats` stays one booking too high until it is recomputed: the counters are caches that can always be recomputed from the bookings (spec, "Conventions"). One failing booking does not stop the others.
- **Up to one minute late.** Between the end of a hold and the next run, the seats still count as held. This only delays seats becoming free again; it never lets more seats be sold than exist.
- The e2e test calls `expireDueHolds` directly instead of waiting for the cron.

## Rule for the confirmation (FLT-23, PAY-01)

Confirm only with an update that matches `status: pending_payment` **and** `holdExpiresAt > now`, then move the seats from `heldSeats` to `bookedSeats` of the cabin in one update on the flight (`$inc` both, with the same `arrayFilters` as the hold, and a guard that `heldSeats` is at least the seats). After the hold has ended, the expiry job may already have released the seats and someone else may have taken them, so **a payment that succeeds after the hold must be refunded, not confirmed.**

## Not in this module yet

- **Passenger details and baggage (FLT-19)**: names, dates of birth, passports, extra bags and `baggageTotal`, added to the same `/hold` body.
- **Booking summary (FLT-21)**, shown before the hold.
- **Round trip and passenger types (FLT-12)**: the return segment, held in the same request.
- **Payment and policy acceptance (PAY-01, PAY-02)**: the Stripe payment and `policyAcceptedAt`.
- **Confirmation and reference (FLT-23)**: see the rule above.
- **Reading and cancelling bookings (FLT-25, FLT-26)**: ownership checks, `cancelledAt`, `cancelledBy`, `refundPercent` and the copied cancellation tiers.

## Tests

`models/flight-booking.schema.spec.ts`, `dto/hold-flight-booking.dto.spec.ts` (through the global pipe options), `mappers/flight-booking.mapper.spec.ts`, `flight-bookings.service.spec.ts` (hold before save, fare from the returned flight, infant rounding, release on a failed save), `flight-bookings.controller.spec.ts` (roles), `flight-booking-expiry.service.spec.ts` (expire then release, confirmed and already-expired bookings, failures, the cron) and `test/flight-bookings-hold.e2e-spec.ts` (on the `-test` database: the hold, 6 concurrent requests for 3 seats, every 404 and 409, validation, roles, the expiry and Swagger).
