# Travel Planning and Booking Platform

Software Project I (Winter 2026): a web platform that combines flight booking, hotel booking, itinerary planning with budgeting, and a travel blog.

Stack: NestJS + Mongoose, Next.js (App Router, TypeScript), MongoDB Atlas, Stripe (test mode), Swagger/OpenAPI.

## Repository layout
- `backend/`: NestJS API (Milestone 1)
- `frontend/`: Next.js app (Milestone 2)
- `docs/requirements/`: project description and requirements workbook
- `docs/api/`: API documentation
- `specs/travel-platform.md`: working specification
- `AGENTS.md`, `CLAUDE.md`: rules for AI coding assistants
- `AI_PROMPTS.txt`: AI usage log (required)

## Setup
Full setup instructions will be added here (prerequisites, environment variables, running, seeding, Swagger URL). Requirements: Node 24 (see `.nvmrc`) and npm.

## Team rules
- Never commit `.env` or secrets. Copy `.env.example` to your own `.env` and fill in the values.
- Work on short-lived branches from `develop`, for example `feature/FLT-11-flight-search`.
- Open pull requests into `develop`. The team leader or the second reviewer approves each one.
- The database is shared by the whole team. Read the "Shared database" rules in `AGENTS.md` before you touch it.
