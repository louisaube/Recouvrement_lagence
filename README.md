# Recouvrement

Application built on the Cuisine sauvage foundation (socle): NestJS 11 + Zod + Drizzle + PostgreSQL 16 (`api/`), React +
MUI + Vite (`studio/`), typed client generated from the OpenAPI document (`packages/api-client/`), black-box acceptance
suite (`acceptance/`) and specifications (`specifications/`). How the foundation is organised, what it provides and how a
feature plugs into it: [`docs/socle.md`](docs/socle.md). Rules for coding agents: [`CLAUDE.md`](CLAUDE.md).

## Prerequisites

Linux, macOS or WSL2 with Node.js 22+, pnpm and PostgreSQL 16 listening on `localhost:5432`, with a superuser role
`database` / `database`. (`.cuisine/bin/cuisine setup` installs the tools on a fresh Linux machine.)

## Run the application

```bash
pnpm install
.cuisine/bin/cuisine up                         # starts PostgreSQL, creates the databases, writes the env files, migrates, builds the typed client
```

`cuisine up` does the following by hand if you prefer: create the databases `recouvrement` (development) and `recouvrement_test`
(tests); `.cuisine/bin/cuisine envs` (writes `api/.env.development` and `api/.env.test` from `api/.env.template`,
git-ignored, plus the default variant of `acceptance/variants.yaml` in `api/.env.test`); `pnpm --dir api migrate:all`.

`cuisine up` leaves the API running on port 4000 in the *test* environment; the command below restarts it in
development. Then, in two terminals:

```bash
cd api && NODE_ENV=development bash scripts/server/start.sh   # API on http://localhost:4000, OpenAPI docs on /api, log api/.server-development.log
pnpm api-client:generate                                      # typed client from the running API (after every API change)
pnpm --dir studio dev                                         # studio on http://localhost:5173
```

`.cuisine/bin/cuisine serve` starts PostgreSQL and the API in development, then runs `pnpm start` in `studio`; the studio
defines no `start` script, so launch it yourself with `pnpm --dir studio dev` as above.

`start.sh` builds and starts the API in the background (it stops whatever listens on port 4000 first), waits for
`GET /server/health-check` and exits 0 when the API is healthy. Run it again after every backend change. The studio calls
`http://localhost:4000` unless `VITE_API_URL` says otherwise.

### Signing in

There is no sign-up and no password reset: accounts are created by an administrator (`POST /users`) or directly in the
database tables `base.users` and `base.credentials` (bcrypt hash, see `specifications/socle/data-contract.md`). To get a
first administrator on the development database:

```bash
python3 .cuisine/scripts/accounts.py user admin admin@example.com 'Choose-a-password-1' --env development
```

then sign in at `/connexion`. An administrator creates the other accounts in *Utilisateurs* and organises access in
*Groupes* and *Périmètres*, and reads the trace of every administration change in *Journal*. The user import screen
(`/utilisateurs/import`, from the « Importer des utilisateurs » button of *Utilisateurs*) loads a `.xlsx` or `.csv` file of
accounts in three steps: preview, list of faults, confirmation.

Seeded accounts for the test database are created by the tests themselves (`pnpm --dir api test` truncates `base`), so keep
your own data in the development database (`recouvrement`).

## Checks

```bash
pnpm --dir api type:check
pnpm --dir studio type:check && pnpm --dir studio build
(cd api && NODE_ENV=test bash scripts/server/start.sh)   # tests run against the running test API and the recouvrement_test database
pnpm --dir api test
pnpm acceptance                                          # black-box suite against the running API
```

`.cuisine/bin/cuisine check` replays every gate (types, tests, acceptance, permission matrix, contract, studio build,
browser tests).
