# auth

Registration, login, logout, the authentication cookies and the current user (`/api/auth/*`).

## Built so far

| Route                             | Requirement    | Access             |
| --------------------------------- | -------------- | ------------------ |
| `POST /api/auth/register`         | ACC-01         | Public             |
| `POST /api/auth/login`            | ACC-04, ACC-05 | Public             |
| `GET /api/auth/me`                | ACC-04         | Any logged-in user |
| `PATCH /api/auth/change-password` | ACC-08         | Any logged-in user |

`AuthCookiesService` sets and clears the two authentication cookies (ACC-19). `AuthTokensService` signs and checks the tokens. `JwtAuthGuard` is the guard that protects every route (ACC-04).

## Design decisions

- **Registering does not log the user in.** The route answers 201 with the new account and sets no cookie. The requirement asks for an account, not a session, and login with its lockout rules is ACC-04. The frontend sends the user to the login page next.
- **This module never touches the `users` collection.** `AuthService` calls `UsersService`, which owns the collection and hashes the password. Every way of creating an account therefore hashes in one place.
- **The client sends only `name`, `email`, `password` and `acceptedTerms`.** The role (`user`) and the status (`active`) are set by the server. Any other field, such as `role`, is rejected with 400 by the global `ValidationPipe`.
- **Consent is stored as a date.** `acceptedTerms` must be exactly `true`. The service then saves the time of the request in `consentAcceptedAt`, so the account records when the consent was given.
- **An email that is already registered answers 409** with the message "This email is already registered", as the response conventions in the specification say. The requirement asks for this message, so the route does tell a guest that an email has an account.
- **The email is trimmed and lowercased before it is checked**, so `Sara@Example.com` and `sara@example.com` are the same account.
- **Passwords are limited to 72 characters** (`PASSWORD_MAX_LENGTH`). The workbook sets only the minimum. bcrypt reads only the first 72 bytes, so a longer password would be cut without the user knowing.

## Login and the authentication guard (ACC-04)

- **Every route needs a login unless it is marked `@Public()`.** `JwtAuthGuard` and `RolesGuard` are registered as global guards (`APP_GUARD`) in `AuthModule`, in that order: first who is calling, then whether that role may do it. A feature module only adds `@Public()` or `@Roles(...)` to its routes. This lives in `auth/` and not in `common/`, so no shared-layer pull request was needed.
- **The tokens travel only in httpOnly cookies** (ACC-19). Login sets `access_token` (path `/`, `ACCESS_TOKEN_MINUTES`) and `refresh_token` (path `/api/auth`, `SESSION_INACTIVITY_MINUTES`) and returns the user in the body, with no token in it. The `role` in the body tells the frontend which home page to open.
- **Two secrets, so one token can never pass as the other.** The access token is signed with `JWT_ACCESS_SECRET` and the refresh token with `JWT_REFRESH_SECRET`. Only `HS256` is accepted, so a token that names another algorithm (`none`) is refused. Both secrets are checked when a token is made or read, with a message that names the missing variable. They are not yet checked at startup: that is a shared-layer change in `config/` for its own pull request.
- **The token carries only the user id.** The guard reads the account from the database on every request, so a suspension, a deactivation or a role change applies at once and not when the token expires. The price is one query per request; with a 10-minute token this is the safer choice for a booking site.
- **One message for every failed login.** An unknown email, a wrong password and a deactivated account (ACC-12) all get 401 "Invalid email or password". For an unknown email the service still compares the password with a hash that no password matches, so the answer does not come faster and the response time does not show which emails are registered.
- **A suspended account gets 403 "Your account is suspended"**, as the requirement asks, but only after the password is right, so the suspension is not shown to someone who does not know the password. The guard also refuses a suspended user who still has a valid token.
- **A missing, expired or invalid token answers 401 "You must log in to do this"**, whatever the reason, so the answer does not help someone who forges tokens.
- **`GET /api/auth/me` is here only as the smallest protected route**, to prove that the cookie works and so that the frontend can learn the current user (ACC-19). ACC-19 can extend it.
- **Not built here:** logout, the refresh route and the 30-minute inactivity limit (ACC-06). Until the refresh route exists, the access token expires after `ACCESS_TOKEN_MINUTES` and the user logs in again.
- **Swagger:** log in with `POST /api/auth/login` in Swagger UI. The browser keeps the cookies and sends them with every later request, including the ones made by "Try it out". If the browser does not keep them over `http://localhost`, set `COOKIE_SECURE=false` in your own `backend/.env`.

## Account lockout (ACC-05)

The 5th wrong password in a row locks the account for 15 minutes (`MAX_FAILED_LOGIN_ATTEMPTS` and `LOCKOUT_MINUTES` in `auth.constants.ts`). The state is `failedLoginAttempts` and `lockedUntil` on the user. Neither field ever leaves the API.

- **The 5th failure already gets the lockout answer.** The user does not have to try a 6th time to find out. The answer is **429**, which keeps it apart from 401 (wrong password) and 403 (suspended), so the frontend can tell the three apart by the status. The message says how many minutes are left, rounded up so nobody tries too early: "Too many failed login attempts. Your account is locked. Try again in 15 minutes."
- **A locked account is refused before the password is looked at.** Even the right password gets 429 until the lock ends. The refused attempts are not counted and do not move the end of the lock, so an attacker cannot extend it and the owner knows exactly when it ends.
- **When the lock ends, the count starts again.** The first login after the lock clears `lockedUntil` and sets the count to 0, so the user gets 5 new attempts and not just one. A successful login also sets the count to 0, so the failures have to be in a row. A login only writes to the database when there is something to reset.
- **The count is one atomic `$inc`.** Ten wrong passwords that arrive at the same moment cannot read the same number and slip past the limit. The lock is set with a filter that matches only an account with no active lock, so the first failure over the limit sets it and the others leave it alone.
- **Who is counted.** Only real accounts. An unknown email and a deactivated account (ACC-12) are never counted or locked, so they still answer a plain 401 and cannot be told from "no account". A suspended account is counted like any other, because it is a real account; its right password still gets 403 and is not counted as a failure, and it does not reset the count either, because it is not a successful login. The lock comes before the suspension message.
- **Known trade-off.** The lockout message shows that the email has an account, but only to someone who made 5 wrong attempts on it. The requirement asks the system to "show a lockout message", so it is kept. The same 5 attempts also let anyone lock a known email for 15 minutes. That follows from the rule as the requirement states it; limiting attempts per IP address as well would be a separate feature.
- **Where it lives.** The rule is in `AuthService.login`. The three database operations (`recordFailedLogin`, `clearExpiredLock`, `resetFailedLogins`) are in `UsersService`, which owns the `users` collection. The limits are constants and not environment variables, so no shared-layer change was needed.
- **Not built here:** a `Retry-After` header. The exception filter builds every error response and sets no headers, so adding one is a shared-layer change for its own pull request. The message already says how long is left.

## Change password (ACC-08)

`PATCH /api/auth/change-password` takes `currentPassword` and `newPassword` and returns the account (200).

- **The current password is always checked**, even right after login, so someone who only has the session (a computer left unlocked) cannot take over the account. A wrong one answers **400** "The current password is incorrect", not 401: the user is logged in, and a 401 would make the frontend think the session ended.
- **The new password follows the registration rule** (`PASSWORD_PATTERN`, at most 72 characters). A broken rule is a normal validation error with `newPassword` in `errors`. The current password is not checked against the rule, so an older or temporary password still works.
- **The new password must differ from the current one** (400 "The new password must be different from the current password"). This is checked only after the current password is right, so the answer tells nothing to someone who does not know it. It matters most after a temporary password (ACC-07a, ACC-13). The workbook does not ask for it; it is one string comparison.
- **It clears `mustChangePassword`.** An admin reset (ACC-07a) or a new moderator account (ACC-13) sets the flag. Login and `GET /api/auth/me` return it in the account, and the frontend sends the user to this route while it is `true`. The team chose not to block other routes on the backend while the flag is set; the flag is the signal.
- **The hashing and the write are in `UsersService.updatePassword`**, which owns the `users` collection. It sets the new hash and `mustChangePassword: false` in one update. `findEntityByIdWithPasswordHash` is the lookup for the check; neither method is exposed by a controller.
- **The user stays logged in.** The refresh token is not stored on the server yet (ACC-06), so other sessions cannot be ended here. When ACC-06 stores refresh tokens, revoking the other sessions on a password change is a small addition.
- **Wrong current passwords are not counted for the lockout** (ACC-05). The lockout protects the login of someone who has no session; this route already needs one.
