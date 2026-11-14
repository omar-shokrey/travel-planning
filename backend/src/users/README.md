# users

Owns the `users` collection: the `User` schema, `UsersService`, the public shape of an account (`UserResponseDto`) and its mapper. The profile routes (`/api/users/me`) come with ACC-09 and ACC-12.

## Design decisions

- **Only `UsersService` writes to the `users` collection.** Other modules import `UsersModule` and call the service.
- **Service methods return the entity.** They are called by other services (`AuthService` today). The calling service maps the entity with `toUserResponse` just before it returns, so a document never reaches a controller.
- **The password is hashed here**, in `createRegisteredUser`, with bcrypt and `PASSWORD_SALT_ROUNDS`. A caller passes the plain password once and it is never stored or logged.
- **`createRegisteredUser` takes no role and no status.** It always creates an active account with the `user` role. Moderator accounts (ACC-13) need their own method.
- **A duplicate email is checked twice.** The service looks the email up first and answers 409. If two requests arrive together, the unique index on `email` rejects the second one, and the exception filter turns that error into 409 as well.
- **`UserResponseDto` has `id`, `name`, `email`, `role`, `status` and `createdAt`.** The mapper lists these fields one by one, so the password hash, the login counters and the lock time can never be returned by accident. Add `phone` and `preferredCurrency` when the profile is built (ACC-09).
- **`createdAt` and `updatedAt` are declared on the `User` class without `@Prop()`.** Mongoose writes them (`timestamps: true`). The declarations only give them a type.
- **Names are limited to 100 characters** (`USER_NAME_MAX_LENGTH`). The workbook sets no limit. Reuse the constant in every DTO that accepts a name.
