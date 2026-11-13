@AGENTS.md

Read `specs/travel-platform.md` and the matching requirement ID in `docs/requirements/` before planning a feature.
Prefer plan, small implementation steps, verification, then a concise explanation.
Before you call a task done, run `format`, `lint`, `typecheck`, `test` and `test:e2e` (see Commands in AGENTS.md) and report the results.
Never modify `.env` or secret-bearing files.
Never write to the shared database and never run `npm run seed`. Follow "Shared database" in AGENTS.md.
Use Context7 for current framework docs and Playwright for UI verification.
Record AI assistance in `AI_PROMPTS.txt`.
