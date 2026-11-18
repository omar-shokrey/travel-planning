# Seed module

Loads the reference data (countries, cities, airports, attractions, GEN-12) and creates the one administrator account. It is a command-line script (`seed.ts`), not part of the API: `SeedModule` has no controller.

## How to run

From `backend/`:

```bash
npm run seed -- --dry-run   # checks the files and the database, writes nothing
npm run seed                # writes the reference data and creates the administrator
```

- **Only the team leader runs it**, against the shared database (see "Shared database" in `AGENTS.md`). Nobody else runs either form.
- **Stop `npm run start:dev` first.** `npm run seed` runs `nest build` before `node dist/seed/seed.js`, and the build clears `dist/`.
- **`ADMIN_EMAIL` and `ADMIN_PASSWORD` must be set** in `backend/.env`. `seed.env.ts` checks them at startup on top of the app's own variables (`validateEnv`): the email must be a valid address and the password must follow the platform password rule (`PASSWORD_PATTERN`). If either is wrong, the script stops before connecting and names the variable.
- On any error the script logs `Seed failed: <reason>` and exits with code 1.

## Design decisions

- **The official files are the source.** The four CSV files in `docs/requirements/reference-data/` (`countries.csv`, `cities.csv`, `airports.csv`, `attractions.csv`) are read by `csv-files.ts`, and each record keeps its official id as `_id`: the country `code`, the `city_id`, the airport `iata_code` and the `attraction_id`. Other modules store these ids (for example an itinerary's `EG` and `cairo`), so they must never change. To change the data, change the CSV files in a pull request and the team leader runs the seed again; nobody edits the collections by hand.
- **Check everything first, then write.** Before anything is written, `findProblems` (in `reference-data.ts`) looks for repeated ids, cities whose country is not in `countries.csv`, airports whose city is missing or in another country, and attractions whose city is missing. Then every record is validated against its Mongoose schema. A missing file, an empty file or a missing column also stops the run. If there is any problem, the script lists them all with their file and line and writes nothing.
- **Running it again is safe.** `planChanges` compares the files with what is stored, by id: a new id is inserted, a stored record whose fields differ gets only those fields updated, and an identical record is left alone. It never deletes anything, so a record that was removed from a file stays in the database.
- **One administrator, created once.** If no account has `ADMIN_EMAIL` (trimmed, lower case), the script creates one with the role `admin`, status `active` and a hashed `ADMIN_PASSWORD`. If an administrator with that email already exists, it is left unchanged: the seed never resets its password. If the email belongs to an account that is not an administrator, the script stops and writes nothing. There is no other way to create an administrator (no admin self-registration).
- **The dry run prints the same counts.** It runs the same checks and the same comparison, and logs `<collection>: N added, N updated, N unchanged (dry run)` and whether the administrator would be created, without writing. It still needs the database connection, because it compares with what is stored.
- **Currencies are reported, not stored.** At the end the script logs the currencies found in `countries.csv`.

## Tests

`csv-files.spec.ts`, `reference-data.spec.ts` and `seed.env.spec.ts` test the file reading, the checks, the change plan and the variable checks without a database. `SeedService` itself has no spec yet.
