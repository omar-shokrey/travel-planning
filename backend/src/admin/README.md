# admin

The admin console (`/api/admin/*`): account management, moderator accounts, provider activation, the admin booking list, report handling and audit log views. Every route is for administrators only: `@Roles(Role.Admin)` is set once on `AdminController`.

## Built so far

| Route                                      | Requirement | Access |
| ------------------------------------------ | ----------- | ------ |
| `POST /api/admin/users/:id/reset-password` | ACC-07a     | Admin  |
| `GET /api/admin/accounts`                  | ACC-14      | Admin  |
| `POST /api/admin/moderators`               | ACC-13      | Admin  |

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

## Report handling and moderation (GEN-10)

| Route                                 | Requirement    | Access |
| ------------------------------------- | -------------- | ------ |
| `GET /api/admin/reports`              | GEN-09, GEN-10 | Admin  |
| `PATCH /api/admin/reports/:id`        | GEN-10         | Admin  |
| `PATCH /api/admin/content/:type/:id`  | GEN-10         | Admin  |
| `DELETE /api/admin/content/:type/:id` | GEN-10         | Admin  |

- **Own files.** `AdminModerationController` (`@Controller('admin')`, `@Roles(Role.Admin)` on the class) and `AdminModerationService` sit next to `AdminController` and `AdminService`, so this feature and the account features (ACC-15, GEN-07 audit) change different files. `AdminModule` imports `ReportsModule`, `BlogModule`, `ItinerariesModule` and `UploadsModule`; none of them imports `AdminModule`.
- **The owning modules do the writes.** `ReportsService` reads and resolves reports, `PostsService` and `ItinerariesService` hide and delete their content (`existsById`, `setHidden`, `removeByAdmin`), and `UploadsService` deletes image files. `AdminModerationService` only decides the order and maps the answers.
- **Posts and itineraries only (team decision).** `:type` is `post` or `itinerary` (the values of `ReportTargetType`), checked with `ParseEnumPipe`; anything else answers 400 "type must be one of: post, itinerary". Comments (BLG-05, PR #142) and hotel reviews are added with GEN-09's `comment` and `review` report types by a later PR, which adds them here too.
- **The report list** (`?page&limit&status&targetType`): open reports by default, because the list is the admin's work queue; `status` shows `dismissed`, `hidden` or `deleted` reports instead. **Oldest first** (`createdAt`, then `_id`), so the report that has waited longest is handled first. Each item: `id`, `targetType`, `targetId`, `reason`, `status`, `reporterId`, `createdAt`, and `resolvedBy` and `resolvedAt` once resolved. Pagination follows GEN-05.
- **Resolving a report** (`{ "action": "dismiss" | "hide" | "delete" }`) sets its status to `dismissed`, `hidden` or `deleted`, `resolvedBy` (the admin, from the login) and `resolvedAt`.
  - **Only an open report can be resolved: 409 otherwise.** The report is claimed first with a conditional update on `status: open`, and the content changes only after that, so of two admins at the same moment one wins and the other gets 409 "This report has already been resolved" without touching the content.
  - **`hide` and `delete` also resolve the other open reports of the same content** with the same status, admin and time, because the content they point at has changed and nobody needs to handle them again. **`dismiss` affects this report only**: another user's report of the same content may have a better reason.
  - **Content that is already gone** (its author deleted it since): `hide` answers 409 ("The reported post no longer exists, so it cannot be hidden. Dismiss the report or delete it instead.") and the report stays open; `delete` is idempotent and just closes the report as `deleted`, because what the admin wanted (the content is gone) is already true. Content that is already hidden is fine for `hide`.
  - An unknown report answers 404 "Report not found"; an id that is not an ObjectId 400; a missing, `null` or unknown `action` 400.
- **`PATCH /api/admin/content/:type/:id` with `{ "moderation": "hidden" | "visible" }` is not in section 8 of the project description**, which only has the `DELETE` route. The workbook asks that an admin can "hide or delete any post, comment, review or itinerary directly", so the hide needs a route; it follows the `DELETE` route's path, and `visible` lets an admin undo a mistaken hide. 404 for unknown content, 409 when it already has that state. Hiding resolves its open reports as `hidden`; showing it again does not reopen reports that were resolved. The answer is `{ type, id, moderation }`. A moderation change does not touch the content's `updatedAt`, which means "last changed by its author" (BLG-03 shows it, ITN-03 sorts by it).
- **`DELETE /api/admin/content/:type/:id`** deletes any post or itinerary (204), whoever wrote it, and resolves its open reports as `deleted`; 404 for unknown content. **Reports are kept** as history. A clone of a deleted itinerary is a separate document and stays.
- **Images of deleted content are deleted** with `UploadsService.deleteImage`, after the database work. A file that cannot be removed is logged (the count only) and does not fail the request, since the content is already gone. An itinerary's activity images that a clone still uses (ITN-21 copies the file names) are kept.
- **What "hidden" changes today:** a hidden post or itinerary answers 404 to anyone but its author in GEN-09 reporting; its author still sees it ("my posts" shows `moderation: hidden`; `GET /api/itineraries/:id` is owner-only). Public search and view of itineraries (ITN-21, open PR) already filter on `moderation: visible`. The public blog routes (BLG-02, BLG-09, BLG-12) do not exist yet; the blog README says they must leave hidden posts out.
- **One enum per module.** `ContentModeration` (here), `PostModeration` (blog) and `ItineraryModeration` (itineraries) have the same two values. The services take `hidden: boolean`, so no module imports another's enum. A shared-layer PR can move one `Moderation` enum to `backend/src/common/enums/` later.
- **No notification to the author.** The notification types of the data model (GEN-01) have no moderation type, and adding one changes the shared spec; GEN-10 does not ask for one. It can be added later if the team wants it.
- **Audit (GEN-07, PR #172, not merged):** after it merges, `AdminModerationService` records `AuditService.record` calls with the admin id it already receives: `dismiss_report` (target: the report), `hide_content` and `delete_content` (target: the post or itinerary, with the report id in `details` when it came from a report), and an action for showing content again if the team wants one.

## Moderator accounts (ACC-13)

`POST /api/admin/moderators` with `name`, `email`, `role`, `providerId` and `temporaryPassword` answers 201 with the new account.

- **Only the two moderator roles.** `role` must be `airline_moderator` or `hotel_moderator`; any other role answers 400. Users register themselves (ACC-01) and admins are seeded.
- **Exactly one provider per moderator.** The provider type follows the role, and the account stores `assignment: { providerType, providerId }`, which the airline and hotel routes already check on every edit. `providerId` must be an existing airline for an airline moderator and an existing hotel for a hotel moderator; otherwise 400 with `providerId` in `errors` ("must be the id of an existing airline/hotel"), so a hotel id sent for an airline moderator is refused too. The lookups use `AirlinesService.findEntityOrThrow` and `HotelsService.findEntityOrThrow`; `AdminModule` imports `FlightsModule` and `HotelsModule`, neither of which imports it back.
- **Several moderators per airline or hotel are allowed** (team decision): the workbook limits the moderator to one provider, not the provider to one moderator.
- **The temporary password works like the admin reset (ACC-07a):** the admin chooses it, it follows the password rule, it is hashed in `UsersService.createModerator`, and the account starts with `mustChangePassword: true`, so the moderator sets a new one at the first login (ACC-08). The response never contains it.
- **An email that is already registered answers 409**, checked first and again by the unique index, as in registration.
- **The response is `UserResponseDto` with `assignment`** (`providerType`, `providerId` as a string). It is left out for accounts that are not moderators, so other responses keep their shape.
- **The client cannot set** the status (always active), `mustChangePassword` or the assignment directly; those fields answer 400.
