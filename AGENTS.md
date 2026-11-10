# AGENTS.md — Travel Planning and Booking Platform

## Project
- Backend: NestJS + Mongoose in `backend/` (Node 24, npm)
- Frontend: Next.js App Router + TypeScript in `frontend/` (Milestone 2; placeholder until then)
- Database: one shared MongoDB Atlas database
- API docs: Swagger UI at `/api/docs` (the backend is evaluated through Swagger in Milestone 1)
- Source of truth: the project description PDF and the official requirements workbook, both in `docs/requirements/`
- Working specification: `specs/travel-platform.md`

## Architecture
1. Follow MVC: Model = Mongoose schemas and services, View = Next.js, Controller = NestJS controllers.
2. Organize the backend into feature modules, one folder each in `backend/src/`: auth, users, admin, flights, flight-bookings, hotels, hotel-bookings, payments, itineraries, blog, notifications, audit, exchange-rates, uploads, reference, reports. What each module owns is in the module table of `specs/travel-platform.md`. Inside a module: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `models/`, `dto/`.
3. Controllers handle HTTP only. Services hold business logic and database access. Schemas define persistence. DTOs validate input.
4. The frontend talks to the API only and never to MongoDB.
5. Security, validation and authorization are enforced on the backend, even when the frontend also validates.
6. Do not add out-of-scope features without approval. Bonus features never replace mandatory ones.

## Contract
- All routes are under `/api`. The endpoint list is section 8 of the project description.
- Roles: guest, registered user, administrator, airline moderator, hotel moderator.
- Role values are in the `Role` enum (`backend/src/common/enums/role.enum.ts`). Every route requires login unless it is marked `@Public()`. Restrict a route with `@Roles(...)`.
- Code shared by several modules lives in `backend/src/common/`: `RolesGuard`, `@Public()`, `@Roles()`, `@CurrentUser()`, `ParseObjectIdPipe`, the exception filter and the pagination DTOs. Use them instead of writing your own.
- Error bodies and paginated lists follow the shapes in the "Response conventions" section of `specs/travel-platform.md`.
- Images (GEN-08): put `@UploadImages()` (or `@UploadImage()` for one file) on the route, then use `UploadsService` from `backend/src/uploads/`: `assertWithinLimit` before saving, `saveImages`, and `deleteImage` when an image or its owner is deleted. Keep the returned `filename` in the owner's document. Files are stored in `backend/uploads/` (git-ignored) and served at `/api/uploads/<filename>`.
- Moderators manage only their one assigned airline or hotel.
- Private bookings and itineraries are visible only to their owner. Check ownership on the backend.
- Authentication uses a secure `httpOnly` cookie. Never store tokens in localStorage or sessionStorage.
- Administrator accounts are seeded. There is no admin self-registration.
- The client must never set server-controlled fields: role, status, prices, booking reference, owner id, payment state.
- A booking is confirmed only after successful payment verification (Stripe test mode, webhook at `POST /api/payments/webhook`).
- Flight and hotel booking must be concurrency-safe. Inventory holds expire and release capacity.
- Reference data (countries, cities, airports, attractions) is seeded from the official datasets, keeping their identifiers.
- Exchange rates come from FXRatesAPI.
- Every requirement has an ID (ACC-, FLT-, HTL-, PAY-, ITN-, BLG-, GEN-). Business rules and limits come from the workbook.

## Quality and security
- No `any` unless unavoidable and justified.
- Validate all external input with DTOs. The global `ValidationPipe` uses `whitelist` and `forbidNonWhitelisted`.
- Hash passwords. Never log or return password hashes.
- Add or update meaningful tests for every change.
- Mongoose schemas: give every enum field an explicit type, for example `@Prop({ type: String, enum: Object.values(Status) })`. NestJS cannot read an enum's type by itself and the app fails to start.
- Do not add packages unless necessary.
- Never expose or edit `.env`, credentials, tokens, API keys or connection strings.

## Conventions
Follow the names the code already uses. The rules for ids, money and dates are also in "Data model diagram, Conventions" in `specs/travel-platform.md`.
- Files and folders: lowercase kebab-case with the role as a suffix, for example `flight-bookings.service.ts`, `create-flight.dto.ts`, `user.schema.ts`, `role.enum.ts`, `roles.guard.ts`. A unit test sits next to its file as `<name>.spec.ts`. End-to-end tests live in `backend/test/` as `<name>.e2e-spec.ts`.
- Classes and enums: PascalCase (`FlightBookingsService`, `Role`). Enum members are PascalCase and their values are lowercase snake_case strings (`AirlineModerator = 'airline_moderator'`).
- Properties, JSON fields and query parameters: camelCase (`countryCode`, `passwordHash`), unless the project description names a parameter differently. Constants and environment variables: UPPER_SNAKE_CASE (`PASSWORD_SALT_ROUNDS`).
- MongoDB collections: plural snake_case as in the data model (`flight_bookings`), set with `@Schema({ collection: '...' })`.
- Routes: lowercase kebab-case plural nouns under `/api`, as in section 8 of the project description (`/api/flight-bookings`).
- Moments in time are stored as UTC dates and returned as ISO 8601 strings in UTC that end in `Z`, for example `2026-11-05T11:00:00.000Z`. Accept ISO 8601 input and convert it to UTC before saving.
- A date without a time (hotel check-in, itinerary start date) is a `YYYY-MM-DD` string, never a `Date`, so no time zone can shift it.
- A flight keeps its times in UTC. Use the airport's IANA time zone (`timeZone`, from `airports.csv`) with `luxon` to show a local time or to compute `departureDateLocal`. Never add or subtract hours by hand.
- Money is a whole number of minor units (cents) plus a currency code, never a floating-point number.

## Commands
First time on a machine, from the repo root: `cp .env.example backend/.env`, then edit `backend/.env`. `backend/.env` is git-ignored, so keys never go to GitHub. Environment variables are checked at startup by `backend/src/config/env.validation.ts`; add a variable there when code starts using it.

Backend:
```bash
cd backend
npm ci                # first time, installs the exact versions from package-lock.json
npm run start:dev     # API with auto-reload
npm run format        # Prettier, before every commit
npm run lint          # oxlint, must report 0 warnings
npm run build         # compile with the Nest CLI
npm test              # unit tests
npm run test:e2e      # end-to-end tests (supertest)
npm run seed -- --dry-run   # check the reference data and the database, writes nothing
npm run seed                # load the reference data and the admin account
```
With `start:dev` running, the API is at `http://localhost:3001/api` and Swagger at `http://localhost:3001/api/docs`.

The team leader runs the seed against the shared database. It needs `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` (the password needs 8 or more characters with a letter and a digit). Stop `start:dev` first, because the build clears `dist/`.

Repo root (formatting and Git hooks):
```bash
npm install
npm run format
```

## Shared database
The whole team uses one MongoDB Atlas database, so a mistake here affects everyone.

- Never drop a collection or the database. Never run `deleteMany({})`, or an `updateMany` or `deleteMany` with a broad filter. The database user has the Atlas role `readwrite_no_drop`, so a drop fails with "not authorized". If you see that error, do not ask for a stronger user. Ask the team leader.
- AI assistants: never write or run code that drops, renames or bulk-deletes anything in the shared database, even if you are asked to.
- Create only the few records you need to check your feature, through Swagger or the API. Delete your own test records one by one, by id. Do not touch records you did not create.
- Do not write scripts that fill the shared database with fake data.
- Automated tests must not write to the shared database. A separate test database is set up before any test needs to store data.
- Do not run `npm run seed`. Only the team leader runs it on the shared database. Do not edit the reference data (countries, cities, airports, attractions) by hand. Change the CSV files in `docs/requirements/reference-data/` through a pull request, and the team leader runs the seed again.
- Do not create or change collections or indexes by hand in Atlas or Compass. Mongoose creates them from the schemas when the app starts.
- The connection string goes only in your own `backend/.env` and in the private team chat. Never put it in a commit, an issue, a pull request, a screenshot or an AI chat.
- If you delete or change data by mistake, tell the team leader at once. Do not try to repair it with another bulk command.

## Git workflow
- Long-lived branches: `main` (milestone releases) and `develop` (integration). Never commit directly to either.
- Create short-lived branches from the latest `develop`: `feature/<REQ-ID>-<description>`, `fix/<REQ-ID>-<description>`, `refactor/<description>`, `docs/<description>`.
- Commit with Conventional Commits, for example `feat(flights): add round-trip search`. Avoid vague messages.
- Open a pull request into `develop`. Title and description must be meaningful and reference the requirement IDs.
- Every pull request is reviewed and approved by the team leader or the second reviewer before it is merged.
- Record AI assistance in `AI_PROMPTS.txt`.

## Workflow
Plan, implement in small steps, verify, read the diff, log AI usage, open a PR, review, CI, merge.
