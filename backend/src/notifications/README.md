# notifications

In-app notifications (GEN-01): the unread count, the notification list and "mark as read", for booking confirmation, cancellation and refund, flight schedule change, and account or provider suspension. Each notification is also sent by email when SMTP is configured (GEN-01-B), and new moderators get an invitation email. Owns the `notifications` collection.

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
- **Not built:** push or live updates. The frontend asks for the unread count when it needs it.

## Email (GEN-01-B)

"The system shall also send the GEN-01 notifications (plus moderator invitations) by email via SMTP, using a test inbox in development." This adds no route and changes no Swagger document.

| File                 | What it does                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `mail-transport.ts`  | `MAIL_TRANSPORT`: the nodemailer transporter built from the `SMTP_*` settings, or `null` when `SMTP_HOST` is empty |
| `email.service.ts`   | `EmailService`: sends the notification emails and the moderator invitation, bounded, never throwing                |
| `email-templates.ts` | Pure functions: the subject and the plain-text body of each email                                                  |
| `email.constants.ts` | The subject of each `NotificationType`, the invitation subject, the timeouts and the in-flight limit               |

Environment variables (checked at startup in `backend/src/config/env.validation.ts`, listed in `.env.example`): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM`; the body links to `FRONTEND_URL`.

**Development: use a local test inbox** that catches every email and sends nothing on, for example Mailpit:

```bash
docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
```

then set `SMTP_HOST=localhost` and `SMTP_PORT=1025` in your own `backend/.env` and open the inbox at http://localhost:8025.

- **Switched off when `SMTP_HOST` is empty** (the default). The transport is `null`, `EmailService.enabled` is false, nothing is looked up or sent and nothing fails. CI, the end-to-end tests and every developer without a mail server work as before. The end-to-end setup (`test/support/smtp-env.ts`) forces it off even if your own `backend/.env` names a server; the suites that check emails replace `MAIL_TRANSPORT` with `FakeMailTransport`, which only collects them.
- **A second, independent step.** `notify` and `notifyMany` keep their signatures and their "never throws" rule. After the insert attempt they hand the email to `EmailService.runInBackground`: it runs even when the insert failed, its failure never removes the in-app notification, and the caller does not wait for the mail server (a payment webhook or a flight cancellation answers as soon as its own write is done). `EmailService.whenIdle` waits for it in tests, and `app.close()` waits for the emails already started.
- **One lookup query.** The recipients are read with one `find({ _id: { $in: ids }, status: { $ne: 'deactivated' } })`, address and name only, through the User model of `UsersModule` (read only; `UsersModule` does not import this module, so there is no cycle). A deactivated account (ACC-12) gets no email; a suspended one still does, since it is told about its suspension.
- **Plain text, fixed subjects.** Each `NotificationType` has a fixed subject in `email.constants.ts`. The body is "Hello <name>," + the notification text + a line asking to log in at `FRONTEND_URL` to see the details. No HTML and no deep link: plain text only, and the frontend routes are not fixed. Text a user wrote (a name, a hotel name) only ever goes into the body, never into the subject or a header, and `to` is always the stored address of an account, so nothing can add a header or a recipient. `MAIL_FROM` is checked as one sender at startup.
- **Bounded sending.** Each SMTP step (connection, greeting, socket) times out after 5 seconds, at most 5 emails are in flight at once across the whole app (one queue in `EmailService` for every caller, so several notifications at the same moment still share the 5), and one failure never stops the others. With a login on a connection that starts plain (`SMTP_SECURE=false`), STARTTLS is required, so the credentials are never sent unencrypted. A failure is logged once per batch with what was sent, how many of how many failed and nodemailer's error codes (for example `ETIMEDOUT`), never an address, a name, the text or an SMTP credential.
- **The moderator invitation (ACC-13).** When the admin creates a moderator, `AdminService.createModerator` calls `EmailService.sendModeratorInvitation` in the background once the account is saved: the moderator's name, their role, the login address and the instruction to sign in with the temporary password the administrator gave them and change it at the first login. **The email never contains the password**; the template is not even given it. A failed invitation never fails or delays the creation; it is logged.
- **Package:** `nodemailer` 10, which ships its own TypeScript types (so no `@types/nodemailer`).
