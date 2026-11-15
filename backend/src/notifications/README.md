# notifications

In-app notifications (GEN-01): the unread count, the notification list and "mark as read", for booking confirmation, cancellation and refund, flight schedule change, and account or provider suspension. Owns the `notifications` collection.

## Routes

| Route                                 | Requirement | Access             |
| ------------------------------------- | ----------- | ------------------ |
| `GET /api/notifications`              | GEN-01      | Any logged-in user |
| `GET /api/notifications/unread-count` | GEN-01      | Any logged-in user |
| `PATCH /api/notifications/:id/read`   | GEN-01      | Any logged-in user |
| `PATCH /api/notifications/read-all`   | GEN-01      | Any logged-in user |

A user only ever sees and changes their own notifications.

## How other modules send one

Import `NotificationsModule` and inject `NotificationsService`. Call it after your own write has succeeded (the "side effects" step of a service method):

```ts
await this.notifications.notify(
  booking.userId,
  NotificationType.BookingConfirmed,
  `Your flight booking ${booking.reference} is confirmed.`,
  { type: NotificationLinkType.FlightBooking, id: booking._id },
);

// The same text to many users in one write, for example every passenger of a flight:
await this.notifications.notifyMany(
  passengerUserIds,
  NotificationType.FlightChanged,
  message,
  {
    type: NotificationLinkType.Flight,
    id: flight._id,
  },
);
```

| Caller (requirement)                  | Type                   |
| ------------------------------------- | ---------------------- |
| Payment confirmed (FLT-23, HTL-17)    | `booking_confirmed`    |
| Cancellation (FLT-06, FLT-09, HTL-10) | `booking_cancelled`    |
| Refund (PAY-03)                       | `refund`               |
| Flight time changed (FLT-05)          | `flight_changed`       |
| Account suspended (ACC-15, ACC-16)    | `account_suspended`    |
| Hotel or airline deactivated (ACC-15) | `provider_deactivated` |

A module that needs another reason adds a value to `NotificationType`.

## Design decisions

- **`notify` and `notifyMany` never throw.** They run after the booking, refund or suspension is already saved. If the notification write fails, the error is logged (type and count only, never the text) and the caller carries on. Otherwise a working payment could answer 500, and Stripe would retry the webhook for an event that already succeeded.
- **`notifyMany` writes in one `insertMany`** and notifies each user once even if the id is listed twice, so a flight with 200 passengers costs one database call.
- **The text is written by the caller, in English, when the event happens.** It is stored, so a later change to a booking does not rewrite old notifications. The link (`linkType`, `linkId`) lets the frontend open the booking, flight or hotel.
- **Unread means `readAt` is empty.** There is no separate boolean in the database; the response adds `read: true | false` for the frontend. Marking a read notification again keeps the first read time.
- **Someone else's notification answers 404, not 403**, the same as a missing one, so a user cannot learn which ids exist.
- **`PATCH /read-all` uses `updateMany`, filtered on one user's unread notifications.** That is never a broad filter on the shared database.
- **The owner id never leaves the API.** The caller always knows it is their own.
- **Notifications are kept.** The workbook sets no retention, so nothing is deleted. A TTL index can be added later if the collection grows.
- **Index `(userId, readAt, createdAt)`** serves the list, the unread filter and the unread count.
- **Not built:** email notifications (GEN-01-B, an optional bonus) and push or live updates. The frontend asks for the unread count when it needs it.
