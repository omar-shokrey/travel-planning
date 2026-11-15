# admin

The admin console (`/api/admin/*`): account management, moderator accounts, provider activation, the admin booking list, report handling and audit log views. Every route is for administrators only: `@Roles(Role.Admin)` is set once on `AdminController`.

## Built so far

| Route                                      | Requirement | Access |
| ------------------------------------------ | ----------- | ------ |
| `POST /api/admin/users/:id/reset-password` | ACC-07a     | Admin  |
| `GET /api/admin/accounts`                  | ACC-14      | Admin  |

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
- **Not built here:** the audit record of the reset (GEN-07, wave 3) and a notification to the owner. Other sessions of the account are not ended, because refresh tokens are not stored on the server yet (ACC-06).

## Account list (ACC-14)

`GET /api/admin/accounts?page=1&limit=10&search=sara&role=user&status=active`

- **Every account is listed**, users, moderators and admins, in every status, because the requirement says "all accounts". Each item is the normal `UserResponseDto`: name, email, role, status and the registration date (`createdAt`), plus `mustChangePassword`. Nothing private is returned.
- **Newest first**, by `createdAt` and then `_id`, so the order is stable when two accounts were created at the same moment.
- **`search` matches part of the name or the email, in any letter case.** It is plain text: characters such as `.` or `*` are escaped, so a search can never be a pattern that matches everything or runs for long. A blank search means no search. It is limited to 254 characters (the longest email address).
- **`role` and `status` filter**, and all given filters must match together. An unknown role or status, a page size over 50 or an unknown parameter answers 400 (the global `ValidationPipe`).
- **Pagination follows GEN-05:** 10 per page by default, at most 50, `{ items, meta }`, and an empty page is `items: []`.
- **The query is in `UsersService.listAccounts`**, which owns the collection and returns entities; `AdminService` maps them with `toUserResponse` and builds the page with `paginate`. Documents are not read with `lean()`, so schema defaults (such as `mustChangePassword: false`) apply to older accounts.
- **The search uses the `$regex` string form** (`{ $regex, $options: 'i' }`), not a RegExp object. In our e2e runs against Atlas, a count with RegExp objects and the `i` flag inside `$or` never got an answer, while the string form always did. Both mean the same to MongoDB.
