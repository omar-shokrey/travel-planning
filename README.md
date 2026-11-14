# Travel Planning and Booking Platform

Software Project I (Winter 2026): a web platform that combines flight booking, hotel booking, itinerary planning with budgeting, and a travel blog.

## Status

- Milestone 1, backend and API: due 20/11/2026. The API is checked through Swagger UI.
- Milestone 2, frontend and integration: due 11/12/2026. `frontend/` stays empty until then.

## Stack

- Backend: NestJS 12 and Mongoose, in TypeScript, on Node 24
- Frontend: Next.js (App Router, TypeScript)
- Database: MongoDB Atlas (one shared database for the team)
- Payments: Stripe, test mode only
- API documentation: Swagger/OpenAPI
- Tests and checks: Jest, oxlint, Prettier, GitHub Actions

## Repository layout

- `backend/`: NestJS API (Milestone 1)
- `frontend/`: Next.js app (Milestone 2)
- `docs/requirements/`: project description, requirements workbook and the reference data (countries, cities, airports, attractions)
- `docs/api/`: API documentation
- `specs/travel-platform.md`: working specification
- `.github/`: CI workflow, pull request template, issue templates, code owners
- `AGENTS.md`, `CLAUDE.md`: team rules and rules for AI coding assistants
- `AI_PROMPTS.txt`: AI usage log (required)

## Getting started

You need Node 24.15 or newer 24.x (see `.nvmrc`), npm, Git, and the private team chat for the shared values. In `backend/`, npm refuses to install on an older Node.

1. Clone the repository and switch to `develop`.
2. From the repo root, install the Git hooks and Prettier:

   ```bash
   npm install
   ```

3. From the repo root, copy the example environment file. It is git-ignored, so your keys never go to GitHub.

   ```bash
   cp .env.example backend/.env
   ```

   On Windows PowerShell: `Copy-Item .env.example backend\.env`

4. Open `backend/.env` and fill in the values (see the table below). At least `MONGODB_URI` is needed to start the API.
5. Install the backend packages:

   ```bash
   cd backend
   npm ci
   ```

6. Start the API with auto-reload:

   ```bash
   npm run start:dev
   ```

7. Check it works. Swagger UI is at <http://localhost:3001/api/docs>. The health check is at <http://localhost:3001/api/health> and answers `{ "status": "ok", "database": "up" }` when the database is connected.

All routes are under `/api`.

## Environment variables

The variables are checked at startup in `backend/src/config/env.validation.ts`. A wrong value stops the app with a clear message.

| Variable                                         | When you need it                 | Where the value comes from                                                   |
| ------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------- |
| `MONGODB_URI`                                    | Always                           | The private team chat. It is the shared Atlas database.                      |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`        | When login is built (ACC-04)     | Two different random strings. The command to make them is in `.env.example`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`     | When payments are built (PAY-01) | Your own Stripe account in test mode. Do not share these.                    |
| `FXRATES_API_KEY`                                | When exchange rates are used     | The private team chat.                                                       |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                  | Team leader only, for the seed   | The team leader's own `backend/.env`.                                        |
| `PORT`, `FRONTEND_URL`, `UPLOADS_DIR`, and so on | Never, the defaults work         | Leave them as in `.env.example`.                                             |

- Never commit `.env` or any secret.
- The connection string goes only in your own `backend/.env` and in the private team chat. Never put it in a commit, an issue, a pull request, a screenshot or an AI chat.
- Safari does not accept `Secure` cookies on `http://localhost`. If you use Safari, set `COOKIE_SECURE=false` in your own `backend/.env`.

## Commands

Run these inside `backend/`. The full list is in [backend/README.md](backend/README.md).

```bash
npm run start:dev     # API with auto-reload
npm run format        # Prettier, before every commit
npm run lint          # oxlint, must report 0 warnings
npm run typecheck     # types, including the specs
npm test              # unit tests
npm run test:e2e      # end-to-end tests, on the test database
npm run build         # compile the API
```

Before you open a pull request, run `format`, `lint`, `typecheck`, `test`, `test:e2e` and `build`. CI runs `lint`, `typecheck`, `build`, `test` and `test:e2e` on every pull request. It does not check formatting: a Git hook formats your staged files when you commit, and `npm run format:check` at the repo root checks every file.

## Tests and databases

- Unit tests do not use a database.
- End-to-end tests use a separate database: the name in `MONGODB_URI` plus `-test` (for example `travel-planning-test`). They never touch the shared database, and they stop if they cannot build that name. In CI they run against a temporary MongoDB container.

## Shared database

The whole team uses one Atlas database, so a mistake affects everyone. The rules are in `AGENTS.md`, in the "Shared database" section. The short version:

- Never drop a collection or the database. Never run a broad `deleteMany` or `updateMany`.
- Create only the few records you need to check your feature. Delete your own test records one by one, by id.
- Do not run `npm run seed`. Only the team leader runs it.
- Do not create or change collections or indexes by hand. Mongoose creates them from the schemas.
- If you delete or change data by mistake, tell the team leader at once.

## Git workflow

- Work on short-lived branches from the latest `develop`, for example `feature/FLT-11-flight-search`. Never commit directly to `develop` or `main`.
- Use Conventional Commits, for example `feat(flights): add round-trip search`.
- Open pull requests into `develop` and fill in the pull request template. The team leader or the second reviewer approves each one, and CI must pass.
- Log your AI use in `AI_PROMPTS.txt` in the same pull request.
- A feature pull request changes only its own module. Changes to the shared layer go in their own pull request.

The details are in `AGENTS.md`, in the "Ownership and the shared layer" and "Git workflow" sections.

## Troubleshooting

- `npm ci` fails with an engine error: your Node is older than 24.15. Install Node 24 and check with `node -v`.
- The API stops with "Invalid environment variables": open `backend/.env` and fix the line named in the message. An empty `MONGODB_URI` is the usual cause.
- `npm run test:e2e` stops with "MONGODB_URI is not set": add it to `backend/.env`.
- Jest prints an "ExperimentalWarning": this is expected, it runs with `--experimental-vm-modules`.
- A command fails with "not authorized": the database user cannot drop anything on purpose. Do not ask for a stronger user. Ask the team leader.
- Port 3001 is busy: stop the other program, or set `PORT` in your own `backend/.env`.

## More documentation

- [AGENTS.md](AGENTS.md): architecture, conventions, commands and team rules
- [specs/travel-platform.md](specs/travel-platform.md): specification, modules and data model
- [docs/requirements/](docs/requirements/): project description and requirements workbook
- [backend/README.md](backend/README.md): backend commands and notes
