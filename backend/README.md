# Backend

NestJS 12 REST API for the Travel Planning and Booking Platform (MongoDB Atlas database).

Team rules, setup of environment variables and the Git workflow are in the [root README](../README.md) and [AGENTS.md](../AGENTS.md).

## Commands

Run these inside `backend/`.

| Command | What it does |
|---|---|
| `npm ci` | Install the exact versions from `package-lock.json` |
| `npm run start:dev` | Start the API with auto-reload |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit tests (Jest) |
| `npm run test:e2e` | End-to-end tests |
| `npm run lint` | Lint with oxlint |

## Notes

- Requires Node 24 (24.15 or newer). `.npmrc` sets `engine-strict`, so npm refuses to install on an older Node.
- Jest runs through `node --experimental-vm-modules` because NestJS 12 packages are ES modules. The "ExperimentalWarning" it prints is expected.
