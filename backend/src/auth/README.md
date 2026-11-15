# auth

Registration, login, logout, the authentication cookies and the current user (`/api/auth/*`).

## Built so far

| Route                             | Requirement    | Access                                 |
| --------------------------------- | -------------- | -------------------------------------- |
| `POST /api/auth/register`         | ACC-01         | Public                                 |
| `POST /api/auth/login`            | ACC-04, ACC-05 | Public                                 |
| `POST /api/auth/logout`           | ACC-06         | Public (see below)                     |
| `POST /api/auth/refresh`          | ACC-06         | Public (the refresh cookie is checked) |
| `GET /api/auth/me`                | ACC-04         | Any logged-in user                     |
| `PATCH /api/auth/change-password` | ACC-08         | Any logged-in user                     |

`AuthCookiesService` sets, clears and reads the two authentication cookies (ACC-19). `AuthTokensService` signs and checks the tokens. `SessionsService` owns the `sessions` collection (ACC-06). `JwtAuthGuard` is the guard that protects every route (ACC-04).

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
- **The token carries the user id and the session id.** The guard reads the account from the database on every request, so a suspension, a deactivation or a role change applies at once and not when the token expires. The price is one query per request; with a 10-minute token this is the safer choice for a booking site.
- **One message for every failed login.** An unknown email, a wrong password and a deactivated account (ACC-12) all get 401 "Invalid email or password". For an unknown email the service still compares the password with a hash that no password matches, so the answer does not come faster and the response time does not show which emails are registered.
- **A suspended account gets 403 "Your account is suspended"**, as the requirement asks, but only after the password is right, so the suspension is not shown to someone who does not know the password. The guard also refuses a suspended user who still has a valid token.
- **A missing, expired or invalid token answers 401 "You must log in to do this"**, whatever the reason, so the answer does not help someone who forges tokens.
- **`GET /api/auth/me` is here only as the smallest protected route**, to prove that the cookie works and so that the frontend can learn the current user (ACC-19). ACC-19 can extend it.
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
- **The user stays logged in, and so do the other sessions of the account.** Since ACC-06 the sessions are stored, so ending the others is possible, but it needs a "revoke all sessions of this user" method in `SessionsService`, which does not exist yet. ACC-08 does not ask for it; it is a small follow-up.
- **Wrong current passwords are not counted for the lockout** (ACC-05). The lockout protects the login of someone who has no session; this route already needs one.

## Logout, refresh and the 30-minute limit (ACC-06)

A login starts a **session**, one document in `sessions` (`userId`, `refreshTokenHash`, `lastActivityAt`, `expiresAt`, `revokedAt`), as the data model in the specification describes. Both tokens carry its id (`sid`). A valid signature is not enough to get in: the guard also asks the session whether it is still live.

- **Logout revokes the session on the server.** It sets `revokedAt`, so the access token stops working at once and not when it expires after `ACCESS_TOKEN_MINUTES`, and the refresh token stops working too. The route also clears both cookies. It answers **204**.
- **Logout is `@Public()` and never fails.** The requirement says a logged-in user logs out, but an access token lasts only `ACCESS_TOKEN_MINUTES`. If logout needed a valid one, a user whose token just expired would get 401, the cookies would stay, and the refresh token would stay valid on the server. So logout reads the cookies itself: the refresh cookie is sent to `/api/auth`, and an expired token still ends its session as long as its signature is right. A token that is not ours revokes nothing. Logging out twice, or with no cookie, is a harmless 204.
- **Logout ends one session, not all of them.** Another browser of the same user stays logged in. "Log out everywhere" is not in the requirements.
- **The 30 minutes are counted on the session.** `expiresAt` is `lastActivityAt` plus `SESSION_INACTIVITY_MINUTES`. Every authenticated request that gets through the guard moves it forward (one indexed `updateOne`), so a session with no authenticated request for 30 minutes has run out and the next request gets 401 "You must log in to do this". The same query refuses a revoked session, a session of another user and a session that does not exist, so they all answer alike. The inactivity limit stays an environment variable, as in ACC-19.
- **A TTL index on `expiresAt` deletes finished sessions**, revoked ones included, so the collection does not grow. MongoDB runs the cleanup about once a minute, so the guard never relies on it: it checks `expiresAt` itself.
- **`POST /api/auth/refresh` gets new tokens without the password.** It needs only the `refresh_token` cookie, which is why it is `@Public()`: the access token is exactly what has expired by then. On success both cookies are replaced and the account is returned, like login. The section 8 table of the project description does not list the route, but the specification describes a refresh (ACC-19: "Logging in or refreshing issues new tokens"), and without it a session could not last longer than one access token.
- **A refresh token works once.** The session keeps the SHA-256 hash of the current refresh token. A refresh replaces it with the hash of the new token in a single atomic update that matches only the old hash, so of two refreshes with the same token at the same moment exactly one succeeds. The loser gets 401. A random `jti` in every refresh token makes sure two tokens made in the same second are never the same text. Only the hash is stored, so a leaked database does not hand out working tokens.
- **A refresh counts as activity**, like any authenticated request. The frontend should call it because a user action got a 401, not on a timer; a timer would keep an idle session alive for ever.
- **Every refresh failure is the same 401.** No cookie, a broken or expired token, a revoked or idle session, a token that was already used, a deleted or deactivated account. A suspended account gets 403, like the guard.
- **Every login makes a new session** and there is no limit per user. Old sessions end by logout or by the TTL index. A cap would be a feature of its own.
- **What this changes for a deployment.** Tokens issued before ACC-06 have no session id and are refused, so everybody logs in again once. The `sessions` collection and its indexes are created by Mongoose when the API starts.
- **Known trade-offs.** If the same browser refreshes twice at once (two tabs), the second request gets 401 although the cookie it will have next is fine; the frontend can retry `GET /api/auth/me` once. If a used refresh token is sent again, the session is not revoked. That would catch a stolen token, but it would also log out the user who lost a race; it is not required here.
- **Where it lives.** Logout and refresh are in `AuthService`, the guard check is in `JwtAuthGuard`, and every database operation is in `SessionsService`. No environment variable was added and nothing in the shared layer changed.
