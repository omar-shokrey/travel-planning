# users

Owns the `users` collection: the `User` schema, `UsersService`, the public shape of an account (`UserResponseDto`) and its mapper. It also has the own-profile route `PATCH /api/users/me` (ACC-09, in `UsersController` and `ProfileService`); own-account deactivation (ACC-12) comes later.

## Design decisions

- **Only `UsersService` writes to the `users` collection.** Other modules import `UsersModule` and call the service.
- **Service methods return the entity.** They are called by other services (`AuthService` today). The calling service maps the entity with `toUserResponse` just before it returns, so a document never reaches a controller.
- **The password is hashed here**, in `createRegisteredUser`, with bcrypt and `PASSWORD_SALT_ROUNDS`. A caller passes the plain password once and it is never stored or logged.
- **The password hash is hidden by default.** The schema marks `passwordHash` with `select: false`, so no query returns it. `findEntityByEmailWithPasswordHash` is the one lookup that asks for it (`.select('+passwordHash')`), for the login check (ACC-04). `findEntityById` never returns it. Both return entities for other services and are not exposed by a controller.
- **`createRegisteredUser` takes no role and no status.** It always creates an active account with the `user` role. Moderator accounts (ACC-13) are made by `createModerator`: an active account with a moderator role, the `assignment` to its one airline or hotel, the hash of the temporary password and `mustChangePassword` set. `AdminService` checks the provider first. The mapper adds `assignment` (with a string `providerId`) only when the account has one.
- **`listAccounts` is the query of the admin account list (ACC-14).** It filters by role and status, searches part of the name or the email (escaped, case-insensitive) and returns one page of entities, newest first, with the total. `AdminService` maps and paginates them.
- **`changeStatus(id, from, to)` is the admin suspension (ACC-16).** One `findOneAndUpdate` that matches only when the account still has the `from` status, so two admins acting at once cannot both win; the loser gets `null`.
- **`setTemporaryPassword` is the admin reset (ACC-07a).** In one update it stores the hash of the temporary password, sets `mustChangePassword` and clears the login lockout. `AdminService` calls it; no controller exposes it.
- **A duplicate email is checked twice.** The service looks the email up first and answers 409. If two requests arrive together, the unique index on `email` rejects the second one, and the exception filter turns that error into 409 as well.
- **`UserResponseDto` has `id`, `name`, `email`, `role`, `status`, `mustChangePassword` and `createdAt`.** `mustChangePassword` (ACC-08) tells the frontend that the account has a temporary password and must set a new one. The mapper lists these fields one by one, so the password hash, the login counters and the lock time can never be returned by accident. `phone` and `preferredCurrency` (ACC-09) are added only when the account has them.
- **`createdAt` and `updatedAt` are declared on the `User` class without `@Prop()`.** Mongoose writes them (`timestamps: true`). The declarations only give them a type.
- **`updatePassword` hashes the new password and clears `mustChangePassword` in one update** (ACC-08). `findEntityByIdWithPasswordHash` is the lookup by id that reads the hash, for the check of the current password.
- **Names are limited to 100 characters** (`USER_NAME_MAX_LENGTH`). The workbook sets no limit. Reuse the constant in every DTO that accepts a name.

## Edit my profile (ACC-09)

`PATCH /api/users/me` changes the `name`, `phone` and `preferredCurrency` of the logged-in user and returns the account (200). Any role may use it.

- **Only the fields that are sent change.** `null` removes the phone or the preferred currency. The name can be changed but not removed (`null` or an empty name is 400). An empty body changes nothing and returns the profile.
- **Nothing is saved unless every field is valid.** The DTO checks all three fields first and reports every invalid one in `errors`. The currency is then checked against the countries list. Only then is the profile saved, in one `findByIdAndUpdate` with `$set` and `$unset`, so a request never saves half of its changes.
- **Email, role, status and password are not in the DTO**, so the global `ValidationPipe` rejects them with 400. Changing the password is ACC-08.
- **The phone must be international** (`+` and the country code, checked with `IsPhoneNumber` from class-validator, which uses libphonenumber). Users of a travel site come from many countries, so a number without a country code would be ambiguous. The workbook sets no format; spaces are allowed and kept as typed.
- **The preferred currency must be a currency of the countries list** (the supported currencies of GEN-12: the distinct `currency` values of `countries`). The code is uppercased first, so `eur` is `EUR`. An unknown code answers 400 with `preferredCurrency` in `errors`. It only changes how prices are shown: prices, payments and refunds stay in USD (PAY-04).
- **`ProfileService` does the checks, `UsersService.updateProfile` writes.** `ProfileService` reads `countries` through `ReferenceModule`, as the itineraries module does. Keeping that out of `UsersService` leaves its constructor and its many callers unchanged, and `UsersService` stays the only writer of `users`.
- **The answer is `UserResponseDto`.** `phone` and `preferredCurrency` are left out when the account has none, so the existing responses keep their shape.
