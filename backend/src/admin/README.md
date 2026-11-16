# admin

The admin console (`/api/admin/*`): account management, moderator accounts, provider activation, the admin booking list, report handling and audit log views. Every route is for administrators only: `@Roles(Role.Admin)` is set once on `AdminController`.

## Built so far

| Route                                      | Requirement | Access |
| ------------------------------------------ | ----------- | ------ |
| `POST /api/admin/users/:id/reset-password` | ACC-07a     | Admin  |
| `GET /api/admin/accounts`                  | ACC-14      | Admin  |
| `POST /api/admin/moderators`               | ACC-13      | Admin  |
| `PATCH /api/admin/accounts/:id/suspend`    | ACC-16      | Admin  |
| `PATCH /api/admin/accounts/:id/reactivate` | ACC-16      | Admin  |

## Design decisions

- **This module never writes to the `users` collection.** `AdminService` calls `UsersService`, which owns it and hashes passwords. The service maps the entity with `toUserResponse` before it returns.
- **The route is the one of section 8 of the project description** (`/api/admin/users/:id/reset-password`), even though the account list (ACC-14) is `/api/admin/accounts`.

## Admin password reset (ACC-07a)

- **The admin chooses the temporary password** and sends it as `temporaryPassword`. The workbook says "reset to a temporary password" and ACC-13 says the temporary password of a moderator is "set by the admin", so both work the same way. The admin gives it to the owner outside the platform. The server never generates or returns a password, so no password appears in a response or a log.
- **The temporary password follows the normal password rule** (`PASSWORD_PATTERN`, at most 72 characters), so the account is never weaker while it waits for the change.
- **`mustChangePassword` becomes `true`.** At the next login the owner must set a new password with `PATCH /api/auth/change-password` (ACC-08), which sets it back to `false`. The team chose a flag only: login returns it and the frontend redirects; the backend does not block other routes.
- **The login lockout is cleared** (`failedLoginAttempts` to 0, `lockedUntil` removed). A user who is locked out is the most likely one to ask for a reset, and the temporary password should work at once. All of it is one `findByIdAndUpdate` in `UsersService.setTemporaryPassword`.
- **Users and moderators only.** Resetting an administrator answers 403 "The password of an administrator cannot be reset here": the requirement names users and moderators, and admin accounts are seeded. This also stops an admin from resetting their own password here (they use ACC-08).
- **The status is not changed.** A suspended or deactivated account keeps its status; the reset only replaces the password. Suspension and reactivation are ACC-15 and ACC-16.
- **Errors:** an id that is not an ObjectId answers 400 (`ParseObjectIdPipe`), an unknown account 404 "Account not found", a caller who is not an admin 403 (`RolesGuard`).
- **Every session of the account ends** (ACC-06 sessions). `SessionsService.revokeAllOfUser` sets `revokedAt` on all of them, with no exception, so the old access and refresh cookies get 401 and whoever held a session, the owner or someone who stole it, must log in with the temporary password. The filter always names that one account. The admin's own session is never touched, because an administrator's password cannot be reset here. `AdminModule` imports `AuthModule`, which exports `SessionsService`; `AuthModule` does not import `AdminModule`, so there is no cycle.
- **The password is saved first, then the sessions end.** If the second step fails, the temporary password is in place but the old sessions stay alive until they log out or run out (30 minutes idle). The other order would end the sessions while the old password still works.
- **Not built here:** the audit record of the reset (GEN-07, wave 3) and a notification to the owner.

## Account list (ACC-14)

`GET /api/admin/accounts?page=1&limit=10&search=sara&role=user&status=active`

- **Every account is listed**, users, moderators and admins, in every status, because the requirement says "all accounts". Each item is the normal `UserResponseDto`: name, email, role, status and the registration date (`createdAt`), plus `mustChangePassword`. Nothing private is returned.
- **Newest first**, by `createdAt` and then `_id`, so the order is stable when two accounts were created at the same moment.
- **`search` matches part of the name or the email, in any letter case.** It is plain text: characters such as `.` or `*` are escaped, so a search can never be a pattern that matches everything or runs for long. A blank search means no search. It is limited to 254 characters (the longest email address).
- **`role` and `status` filter**, and all given filters must match together. An unknown role or status, a page size over 50 or an unknown parameter answers 400 (the global `ValidationPipe`).
- **Pagination follows GEN-05:** 10 per page by default, at most 50, `{ items, meta }`, and an empty page is `items: []`.
- **The query is in `UsersService.listAccounts`**, which owns the collection and returns entities; `AdminService` maps them with `toUserResponse` and builds the page with `paginate`. Documents are not read with `lean()`, so schema defaults (such as `mustChangePassword: false`) apply to older accounts.
- **The search uses the `$regex` string form** (`{ $regex, $options: 'i' }`), not a RegExp object. In our e2e runs against Atlas, a count with RegExp objects and the `i` flag inside `$or` never got an answer, while the string form always did. Both mean the same to MongoDB.

## Moderator accounts (ACC-13)

`POST /api/admin/moderators` with `name`, `email`, `role`, `providerId` and `temporaryPassword` answers 201 with the new account.

- **Only the two moderator roles.** `role` must be `airline_moderator` or `hotel_moderator`; any other role answers 400. Users register themselves (ACC-01) and admins are seeded.
- **Exactly one provider per moderator.** The provider type follows the role, and the account stores `assignment: { providerType, providerId }`, which the airline and hotel routes already check on every edit. `providerId` must be an existing airline for an airline moderator and an existing hotel for a hotel moderator; otherwise 400 with `providerId` in `errors` ("must be the id of an existing airline/hotel"), so a hotel id sent for an airline moderator is refused too. The lookups use `AirlinesService.findEntityOrThrow` and `HotelsService.findEntityOrThrow`; `AdminModule` imports `FlightsModule` and `HotelsModule`, neither of which imports it back.
- **Several moderators per airline or hotel are allowed** (team decision): the workbook limits the moderator to one provider, not the provider to one moderator.
- **The temporary password works like the admin reset (ACC-07a):** the admin chooses it, it follows the password rule, it is hashed in `UsersService.createModerator`, and the account starts with `mustChangePassword: true`, so the moderator sets a new one at the first login (ACC-08). The response never contains it.
- **An email that is already registered answers 409**, checked first and again by the unique index, as in registration.
- **The response is `UserResponseDto` with `assignment`** (`providerType`, `providerId` as a string). It is left out for accounts that are not moderators, so other responses keep their shape.
- **The client cannot set** the status (always active), `mustChangePassword` or the assignment directly; those fields answer 400.

## Suspend and reactivate users (ACC-16)

`PATCH /api/admin/accounts/:id/suspend` and `PATCH /api/admin/accounts/:id/reactivate` answer 200 with the account.

- **Registered users only, for now.** These routes are shared with ACC-15, which suspends moderators. Until ACC-15 extends them, a moderator answers 400 ("Only registered user accounts can be suspended or reactivated here"). An administrator answers 403.
- **What suspension does.** Login and refresh already refuse a suspended account with 403 "Your account is suspended", and the authentication guard refuses its requests. Suspending also ends every session of the account (`SessionsService.revokeAllOfUser`), so its old cookies stop at once (the access cookie gets 401, because the session is checked first) and the user logs in again after a reactivation. The status changes first and the sessions end second, so a failure in between never leaves the account active.
- **Reactivating ends every session again, first.** Two cases leave a session alive through a suspension: ending the sessions failed after the status changed (a retry then answers 409 "already suspended"), or a login that read `active` saved its session just after the suspension ended the others. The guard refuses such a session while the account is suspended, but it would work again after a reactivation. So `reactivate` ends every session of the account while it is still suspended (no new login can happen then), and only then changes the status. If that fails, the account stays suspended and the admin retries.
- **The user is notified (GEN-01).** After the status change, the user gets an `account_suspended` in-app notification ("Your account was suspended by an administrator."). They cannot log in while suspended, so they read it after a reactivation. `notify` never throws, so it cannot fail the suspension. Reactivating sends nothing.
- **One helper for both changes.** `changeUserStatus` holds the shared rules (exists, registered user, not deactivated, expected status, conditional update); `suspend` and `reactivate` only add their session and notification steps.
- **What it does not change.** Bookings stay valid and the user's posts, comments, reviews and itineraries stay visible, as the requirement says. Hiding content is GEN-10.
- **Status rules.** Suspending a suspended account or reactivating an active one answers 409. A deactivated account (closed by its owner, ACC-12) answers 409 to both: an admin does not reopen it.
- **Two admins at once.** `UsersService.changeStatus(id, from, to)` changes the status only if it still is `from`, in one `findOneAndUpdate`. The request that loses answers 409 ("changed by another request") and ends no session.
- **Not here:** the audit record (GEN-07), added after GEN-07 merges.
