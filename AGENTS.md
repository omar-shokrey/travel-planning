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
2. Organize the backend into feature modules, one folder each in `backend/src/`: auth, users, admin, flights, flight-bookings, hotels, hotel-bookings, payments, itineraries, blog, notifications, audit, exchange-rates, uploads, reference, reports. What each module owns is in the module table of `specs/travel-platform.md`. Inside a module: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `schemas/`, `dto/`.
3. Controllers handle HTTP only. Services hold business logic and database access. Schemas define persistence. DTOs validate input.
4. The frontend talks to the API only and never to MongoDB.
5. Security, validation and authorization are enforced on the backend, even when the frontend also validates.
6. Do not add out-of-scope features without approval. Bonus features never replace mandatory ones.

## Contract
- All routes are under `/api`. The endpoint list is section 8 of the project description.
- Roles: guest, registered user, administrator, airline moderator, hotel moderator.
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
- Do not add packages unless necessary.
- Never expose or edit `.env`, credentials, tokens, API keys or connection strings.

## Commands
Backend (after the NestJS project is generated):
```bash
cd backend
npm run start:dev
npm test
npm run lint
```

Repo root (formatting and Git hooks):
```bash
npm install
npm run format
```

## Git workflow
- Long-lived branches: `main` (milestone releases) and `develop` (integration). Never commit directly to either.
- Create short-lived branches from the latest `develop`: `feature/<REQ-ID>-<description>`, `fix/<REQ-ID>-<description>`, `refactor/<description>`, `docs/<description>`.
- Commit with Conventional Commits, for example `feat(flights): add round-trip search`. Avoid vague messages.
- Open a pull request into `develop`. Title and description must be meaningful and reference the requirement IDs.
- Every pull request is reviewed and approved by the team leader or the second reviewer before it is merged.
- Record AI assistance in `AI_PROMPTS.txt`.

## Workflow
Plan, implement in small steps, verify, read the diff, log AI usage, open a PR, review, CI, merge.
