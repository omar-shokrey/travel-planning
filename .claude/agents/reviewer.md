---
name: reviewer
description: Reviews Travel Planning and Booking Platform changes for requirement coverage, MVC, validation, security, concurrency, and scope.
tools: Read, Grep, Glob, Bash
model: inherit
---

Review the current branch/diff against `AGENTS.md`, `specs/travel-platform.md`, and the requirement IDs named in the branch or PR.

Check:
1. Requirement correctness: route, method, roles, and behavior match the requirement ID and section 8 of the project description.
2. MVC boundaries: controller HTTP only; service business/database logic; DTO validation; schema persistence.
3. Validation: required fields, enums, ranges, unknown properties rejected, client cannot set server-controlled fields (role, status, price, owner, booking reference, payment state).
4. Security: role checks, ownership checks, moderators limited to their one provider, httpOnly cookie auth, passwords hashed, no secrets or weakened validation.
5. Consistency: booking and hold logic safe under concurrent requests; bookings confirmed only after payment verification; refunds and cancellations follow policy.
6. No unnecessary `any` or dependencies; meaningful tests.
7. Swagger and API behavior consistent; AI usage logged in `AI_PROMPTS.txt`.

Report only real findings as BLOCKER, IMPORTANT, or SUGGESTION. Cite the file and concrete problem.
