# Travel Planning and Booking Platform — Specification

Source of truth: the project description (`docs/requirements/`) and the official requirements workbook. If this file disagrees with them, they win. Exact business rules, limits and acceptance criteria are in the workbook.

## Problem
Travelers need one platform to search and book flights and hotels, plan day-by-day itineraries with budgets, and share travel content. Airlines and hotels need to manage their inventory and policies, and administrators need to supervise accounts, bookings and community content.

## Users
- Guest: unauthenticated visitor. Searches flights and hotels, browses public blog posts and itineraries.
- Registered user: books flights and hotels, manages bookings, creates itineraries and budgets, publishes or clones public itineraries, writes blog posts, comments, likes, reviews eligible hotel stays, reports content.
- Administrator (seeded): manages accounts, creates moderators, suspends and reactivates users, inspects bookings, moderates reported content, reviews audit logs.
- Airline moderator: manages exactly one assigned airline (profile, flights, cabins, prices, baggage rules, cancellation policies, bookings).
- Hotel moderator: manages exactly one assigned hotel (profile, rooms, availability, prices, policies, reservations).
- System services: payment confirmation, inventory-hold expiry, notifications, exchange rates, booking-state updates, audit logging.

## Scope by module
Requirement IDs are listed in the workbook. The mandatory/bonus split is also defined there.

| Module | ID prefix | Covers |
|---|---|---|
| Accounts and administration | ACC | Registration, login with lockout, logout and session expiry, password change, profile, deactivation, moderator accounts, account management, admin booking list, admin seeding |
| Flights | FLT | Airline profile, airports, flights, cabins, baggage and cancellation policies, search, filters, booking, seat hold, cancellation, passenger lists |
| Hotels | HTL | Hotel profile, rooms, availability, policies, search, multi-room reservation, room hold, cancellation, reviews |
| Payments and policies | PAY | Stripe payment (test mode), policy acceptance, refunds, single platform currency |
| Itineraries | ITN | Itineraries, ordered days, city groups, activities, images, budgets, transport costs, currency conversion, visibility, search and clone |
| Blog | BLG | Posts, comments, likes, tags, search, images, author pages |
| Cross-cutting | GEN | Notifications, validation messages, pagination, time zones, audit log, image uploads, reporting and moderation, booking lifecycle, reference-data seeding, backend enforcement and password hashing |

Optional (bonus) features are marked Optional in the description: email verification and email password recovery (ACC-02, ACC-07), flight change and seat selection (FLT-27, FLT-28), hotel replies to reviews (HTL-26), attaching bookings to itineraries and PDF export (ITN-27, ITN-28), attaching itineraries to posts (BLG-13), email notifications, admin analytics and favourites.

## API contract
Base path `/api`. The full endpoint table is section 8 of the project description. Route groups:

| Group | Base routes |
|---|---|
| Authentication and accounts | `/api/auth/*`, `/api/users/me` |
| Administration | `/api/admin/*` |
| Airlines and flights | `/api/airlines`, `/api/airports`, `/api/flights` |
| Flight bookings | `/api/flight-bookings` |
| Hotels and rooms | `/api/hotels` |
| Hotel bookings and reviews | `/api/hotel-bookings`, `/api/reviews` |
| Payments and refunds | `/api/payments`, `/api/refunds`, `/api/bookings/:type/:id/policies` |
| Itineraries | `/api/itineraries`, `/api/activities`, `/api/budgets`, `/api/transport-costs` |
| Blog | `/api/posts`, `/api/comments`, `/api/tags`, `/api/authors` |

Swagger UI is served at `/api/docs`.

## Validation and security
- Required fields, types and enums are validated by DTOs. Unknown properties are rejected.
- The client cannot set role, status, prices, booking reference, owner or payment state.
- Authentication uses a secure `httpOnly` cookie, never localStorage or sessionStorage.
- Role checks and ownership checks happen on the backend. Moderators are limited to their assigned provider.
- Passwords are hashed. Account emails are unique.
- A booking is confirmed only after successful payment verification through the Stripe webhook.
- Booking and hold logic is safe under concurrent requests. Holds expire and release inventory.
- Policy acceptance is stored with a timestamp.

## MVC and module boundary
- Controller: HTTP concerns only.
- Service: business logic and database operations.
- Mongoose schema/model: persistence.
- DTO: validation.
- Frontend calls the API and never accesses MongoDB directly.
- One feature module per area: auth, users, admin, flights, flight-bookings, hotels, hotel-bookings, payments, itineraries, blog, notifications, audit, exchange-rates, uploads.

## Reference data
Countries, cities, airports and attractions are seeded from the official reference datasets. Records and identifiers must match the datasets, because they are used in the final evaluation. The seed script is idempotent and creates the admin account from environment variables.

## Out of scope
- Cloud deployment (optional bonus)
- Optional features above, until all mandatory requirements are done and the team agrees

## Data model diagram
<!-- Paste the Mermaid ER diagram here once the schemas are designed. -->

## Milestones
- Milestone 1, backend and API: deadline 20/11. Evaluated through Swagger UI.
- Milestone 2, frontend and integration: deadline 11/12.

## Work organization
- Every member contributes to every part of the project.
- One short-lived branch per requirement or issue: `feature/<REQ-ID>-<description>`, from the latest `develop`.
- Pull requests go into `develop` and are approved by the team leader or the second reviewer.
- Reference requirement IDs in issues, branches, commits, PRs and Swagger docs.

## Definition of Done
- Follows this specification, `AGENTS.md` and the requirement's acceptance criteria.
- Relevant tests and lint pass.
- Swagger reflects API changes.
- Authorization and validation are enforced on the backend.
- Diff is reviewed.
- AI usage is logged in `AI_PROMPTS.txt`.
- PR passes CI and the required review.
