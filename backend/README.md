# Backend

NestJS 12 REST API for the Travel Planning and Booking Platform (MongoDB Atlas database).

Setup, environment variables, the shared database rules and the Git workflow are in the [root README](../README.md) and [AGENTS.md](../AGENTS.md).

## Commands

Run these inside `backend/`.

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm ci`            | Install the exact versions from `package-lock.json`              |
| `npm run start:dev` | Start the API with auto-reload                                   |
| `npm run build`     | Compile to `dist/`                                               |
| `npm run format`    | Format `src/` and `test/` with Prettier                          |
| `npm run lint`      | Lint with oxlint                                                 |
| `npm run typecheck` | Check types, including the specs                                 |
| `npm test`          | Unit tests (Jest)                                                |
| `npm run test:e2e`  | End-to-end tests, on the `-test` database                        |
| `npm run seed`      | Load the reference data and the admin account (team leader only) |

`npm run seed -- --dry-run` checks the reference data and the database and writes nothing.

## Notes

- Requires Node 24 (24.15 or newer). `.npmrc` sets `engine-strict`, so npm refuses to install on an older Node.
- Jest runs through `node --experimental-vm-modules` because NestJS 12 packages are ES modules. The "ExperimentalWarning" it prints is expected.
- End-to-end tests read `MONGODB_URI` from `backend/.env` and add `-test` to the database name, so they never write to the shared database.
