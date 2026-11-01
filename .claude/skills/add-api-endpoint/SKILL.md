---
name: add-api-endpoint
description: Use when adding or changing a Travel Planning and Booking Platform NestJS API endpoint.
---

# Add API Endpoint

1. Read `specs/travel-platform.md`, `AGENTS.md`, and the requirement ID in `docs/requirements/`.
2. Find the endpoint in section 8 of the project description. State route, method, roles allowed, input, output, validation, ownership rule, and service responsibility before coding.
3. Preserve controller / service / schema / DTO separation, inside the feature module.
4. Validate input with a DTO. Never let the client set role, status, price, owner, booking reference, or payment state.
5. Enforce authorization and ownership on the backend. Moderators only touch their assigned airline or hotel.
6. Never modify `.env`. Do not add packages unless necessary.
7. Add Swagger decorators, tests, and run lint and tests.
8. Log AI usage in `AI_PROMPTS.txt` and reference the requirement ID in the branch, commits, and PR.

Branch name: `feature/<REQ-ID>-<description>`, created from the latest `develop`.
