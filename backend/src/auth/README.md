# auth

Registration, login, logout, the authentication cookies and the current user (`/api/auth/*`).

## Built so far

| Route                     | Requirement | Access |
| ------------------------- | ----------- | ------ |
| `POST /api/auth/register` | ACC-01      | Public |

`AuthCookiesService` sets and clears the two authentication cookies (ACC-19). Login (ACC-04) will use it.

## Design decisions

- **Registering does not log the user in.** The route answers 201 with the new account and sets no cookie. The requirement asks for an account, not a session, and login with its lockout rules is ACC-04. The frontend sends the user to the login page next.
- **This module never touches the `users` collection.** `AuthService` calls `UsersService`, which owns the collection and hashes the password. Every way of creating an account therefore hashes in one place.
- **The client sends only `name`, `email`, `password` and `acceptedTerms`.** The role (`user`) and the status (`active`) are set by the server. Any other field, such as `role`, is rejected with 400 by the global `ValidationPipe`.
- **Consent is stored as a date.** `acceptedTerms` must be exactly `true`. The service then saves the time of the request in `consentAcceptedAt`, so the account records when the consent was given.
- **An email that is already registered answers 409** with the message "This email is already registered", as the response conventions in the specification say. The requirement asks for this message, so the route does tell a guest that an email has an account.
- **The email is trimmed and lowercased before it is checked**, so `Sara@Example.com` and `sara@example.com` are the same account.
- **Passwords are limited to 72 characters** (`PASSWORD_MAX_LENGTH`). The workbook sets only the minimum. bcrypt reads only the first 72 bytes, so a longer password would be cut without the user knowing.
