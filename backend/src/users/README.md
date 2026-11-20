# users

Owns the `users` collection: the `User` schema, `UsersService`, the public shape of an account (`UserResponseDto`) and its mapper. It also has the own-account routes `GET /api/users/me` (ACC-11) and `PATCH /api/users/me` (ACC-09), in `UsersController` and `ProfileService`. `DELETE /api/users/me` (ACC-12, deactivate my own account) is in the auth module; see below.

## Design decisions

- **Only `UsersService` writes to the `users` collection.** Other modules import `UsersModule` and call the service.
- **Service methods return the entity.** They are called by other services (`AuthService` today). The calling service maps the entity with `toUserResponse` just before it returns, so a document never reaches a controller.
- **The password is hashed here**, in `createRegisteredUser`, with bcrypt and `PASSWORD_SALT_ROUNDS`. A caller passes the plain password once and it is never stored or logged.
- **The password hash is hidden by default.** The schema marks `passwordHash` with `select: false`, so no query returns it. `findEntityByEmailWithPasswordHash` is the one lookup that asks for it (`.select('+passwordHash')`), for the login check (ACC-04). `findEntityById` never returns it. Both return entities for other services and are not exposed by a controller.
- **`createRegisteredUser` takes no role and no status.** It always creates an active account with the `user` role. Moderator accounts (ACC-13) are made by `createModerator`: an active account with a moderator role, the `assignment` to its one airline or hotel, the hash of the temporary password and `mustChangePassword` set. `AdminService` checks the provider first. The mapper adds `assignment` (with a string `providerId`) only when the account has one.
- **`listAccounts` is the query of the admin account list (ACC-14).** It filters by role and status, searches part of the name or the email (escaped, case-insensitive) and returns one page of entities, newest first, with the total. `AdminService` maps and paginates them.
- **`changeStatus(id, from, to)` is the admin suspension (ACC-16).** One `findOneAndUpdate` that matches only when the account still has the `from` status, so two admins acting at once cannot both win; the loser gets `null`.
- **`deactivateOwnAccount(id, now)` is the own-account deactivation (ACC-12).** One conditional `findOneAndUpdate` on `{ _id, role: user, status: active }` that sets `status: deactivated` and `deactivatedAt` together and returns the account after, or `null` when nothing matched (suspended meanwhile, already deactivated, or not a user). The auth module calls it after its checks.
- **`setTemporaryPassword` is the admin reset (ACC-07a).** In one update it stores the hash of the temporary password, sets `mustChangePassword` and clears the login lockout. `AdminService` calls it; no controller exposes it.
- **`findNamesByIds(ids)` gives the names that may be shown, in one query** (HTL-24). It returns a map from account id to name and reads only `name`. A missing or deactivated account (ACC-12) is not in the map, so the caller shows "Deleted user"; a suspended account keeps its name. The public reviews of a hotel use it for the authors of a page. No controller exposes it.
- **A duplicate email is checked twice.** The service looks the email up first and answers 409. If two requests arrive together, the unique index on `email` rejects the second one, and the exception filter turns that error into 409 as well.
- **`UserResponseDto` has `id`, `name`, `email`, `role`, `status`, `mustChangePassword` and `createdAt`.** `mustChangePassword` (ACC-08) tells the frontend that the account has a temporary password and must set a new one; the backend enforces it too (ACC-13, ACC-07a, GEN-13): `JwtAuthGuard` answers 403 on every route but `GET /api/auth/me` and `PATCH /api/auth/change-password` while it is `true` (see the auth README). The mapper lists these fields one by one, so the password hash, the login counters and the lock time can never be returned by accident. `phone` and `preferredCurrency` (ACC-09) are added only when the account has them.
- **`createdAt` and `updatedAt` are declared on the `User` class without `@Prop()`.** Mongoose writes them (`timestamps: true`). The declarations only give them a type.
- **`updatePassword` hashes the new password and clears `mustChangePassword` in one update** (ACC-08). `findEntityByIdWithPasswordHash` is the lookup by id that reads the hash, for the check of the current password.
- **Names are limited to 100 characters** (`USER_NAME_MAX_LENGTH`). The workbook sets no limit. Reuse the constant in every DTO that accepts a name.

## My account (ACC-11)

`GET /api/users/me` returns the account of the logged-in user (200). Any role may use it.

- **The route has no id.** The id comes from the login cookie (`@CurrentUser('id')`) and from nothing else, so a request cannot name another account, and an `id` in the query is ignored. No route reads another user's account by id. An administrator reads other accounts through the list `GET /api/admin/accounts` (ACC-14).
- **It returns the same account as `GET /api/auth/me`.** Section 8 of the project description lists both routes. Both build the answer with `toUserResponse`, so the password hash and the login counters can never be returned. The frontend keeps using `/api/auth/me` to learn who is logged in (ACC-04, ACC-19); `/api/users/me` is the read next to the profile edit (ACC-09).
- **401 when the account is gone.** The authentication guard already loads the account on every request: a missing or deactivated account gets 401 and a suspended one 403 before the route runs. `ProfileService.getMyProfile` answers the same 401 "You must log in to do this" as a backstop, for an account deleted between the guard and the lookup.
- **`getMyProfile` repeats `AuthService.me` on purpose.** `auth` depends on `users`, so `users` cannot call `AuthService` without a circular import.

## Edit my profile (ACC-09)

`PATCH /api/users/me` changes the `name`, `phone` and `preferredCurrency` of the logged-in user and returns the account (200). Any role may use it.

- **Only the fields that are sent change.** `null` removes the phone or the preferred currency. The name can be changed but not removed (`null` or an empty name is 400). An empty body changes nothing and returns the profile.
- **Nothing is saved unless every field is valid.** The DTO checks all three fields first and reports every invalid one in `errors`. The currency is then checked against the countries list. Only then is the profile saved, in one `findByIdAndUpdate` with `$set` and `$unset`, so a request never saves half of its changes.
- **Email, role, status and password are not in the DTO**, so the global `ValidationPipe` rejects them with 400. Changing the password is ACC-08.
- **The phone must be international** (`+` and the country code, checked with `IsPhoneNumber` from class-validator, which uses libphonenumber). Users of a travel site come from many countries, so a number without a country code would be ambiguous. The workbook sets no format; spaces are allowed and kept as typed.
- **The preferred currency must be a currency of the countries list** (the supported currencies of GEN-12: the distinct `currency` values of `countries`). The code is uppercased first, so `eur` is `EUR`. An unknown code answers 400 with `preferredCurrency` in `errors`. It only changes how prices are shown: prices, payments and refunds stay in USD (PAY-04).
- **`ProfileService` does the checks, `UsersService.updateProfile` writes.** `ProfileService` reads `countries` through `ReferenceModule`, as the itineraries module does. Keeping that out of `UsersService` leaves its constructor and its many callers unchanged, and `UsersService` stays the only writer of `users`.
- **The answer is `UserResponseDto`.** `phone` and `preferredCurrency` are left out when the account has none, so the existing responses keep their shape.

## Deactivate my account (ACC-12)

`DELETE /api/users/me` is documented under the `users` tag with the other `/users/me` routes, but it lives in the auth module (`AccountDeactivationController`, `AccountDeactivationService`; see "Deactivate my own account (ACC-12)" in the auth README).

- **Why not here.** It reads the bookings, hides the posts and itineraries and ends the sessions. The blog and itineraries modules import `UsersModule`, so `UsersModule` cannot import them (or the booking modules) without a circular import. The auth module can. This module only adds `deactivateOwnAccount` and stays the only writer of `users`.
- **What a deactivated account means elsewhere.** It cannot log in (401 "Invalid email or password") and its cookies get 401; an admin cannot suspend or reactivate it (409); its author page answers 404; its posts and public itineraries are hidden (`authorDeactivated`); its comments stay and show "Deleted user". The email stays taken (the unique index), so it cannot register again.
- **Reviews follow the same rule:** the public reviews of a hotel (HTL-24) show "Deleted user" for an author whose account is `deactivated` or gone, as the blog does for comments. The names come from `findNamesByIds`, which leaves those accounts out.
