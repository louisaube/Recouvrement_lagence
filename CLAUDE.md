# Recouvrement (socle Cuisine sauvage)

> **Session opératrice.** Si l'on vous demande de fabriquer une version, de reconstruire le socle, de préparer la machine, de recetter ou de vérifier l'application, vous êtes l'opérateur de la cuisine : suivez le skill `cuisine` (`.claude/skills/cuisine/SKILL.md`) et n'écrivez jamais de code applicatif vous-même. Les règles ci-dessous s'adressent aux agents de fabrication lancés par la chaîne.

Monorepo (pnpm workspaces):
- `api/`: NestJS 11, Zod (single source of validation AND of the OpenAPI document), Drizzle ORM, PostgreSQL 16.
- `studio/`: React 18, MUI 6, Vite, React Router.
- `packages/api-client/`: typed client generated from the running API's OpenAPI document (openapi-typescript + openapi-fetch).
- `acceptance/`: black-box acceptance suite (Jest, HTTP + SQL) and browser tests (Playwright, `acceptance/e2e/`). Owned by QA and the human.
- `specifications/`: functional specification (`socle/` for the foundation, `<module>/` for business modules), expected permission matrix, contract of record.

## Read-only for coding agents
`acceptance/**`, `specifications/permissions.yaml`, `specifications/openapi.json`, `specifications/contract-changes.yaml`, `specifications/socle/data-contract.md`, `.cuisine/**`, `CLAUDE.md`. Once the foundation is built, its folders are frozen too: `api/src/platform/**`, `api/src/features/{auth,users,groups,scopes,audit,imports}/**`, `api/src/main.ts`, `api/scripts/**`, `packages/api-client/scripts/**`. Business code goes in new feature folders.

To contest a test, a permission entry or the contract, never edit them: append `OPEN: <test title | permissions <operation> | contract <operation>>: <reason>` to the `DISPUTES.md` of the current implementation-plans folder (or `specifications/socle/DISPUTES.md` during a foundation rebuild). QA arbitrates.

## Tooling contract (the kitchen calls exactly these; keep names, arguments and behaviour)
- Root `package.json`: `name` is the application slug (lowercase letters and digits); scripts `api-client:generate` (regenerates `packages/api-client` from `http://localhost:4000/api-json`).
- `api/.env.template` lists `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `PORT=4000`, `STUDIO_ORIGINS=http://localhost:5173`. The kitchen writes `api/.env.development` and `api/.env.test` from it (git-ignored), plus, in `api/.env.test`, the default variant of `acceptance/variants.yaml`; the API loads `api/.env.<NODE_ENV>` without overriding variables already set, and treats an empty variable as absent. Never write test values into `api/.env.*`: the kitchen rewrites `api/.env.test`.
- Databases: `<slug>` (development) and `<slug>_test` (tests and gates), role `database`/`database` on `localhost:5432`.
- `cd api && NODE_ENV=<development|test> bash scripts/server/start.sh`: stops whatever listens on port 4000, starts the API in the background (log `api/.server-<env>.log`), waits until `GET /server/health-check` answers 200 (60 s at most), exits 0, non-zero otherwise. Restart it after every backend change.
- `bash .cuisine/scripts/acceptance.sh [jest options]` (or `pnpm acceptance`): the acceptance suite. When `acceptance/variants.yaml` exists (QA-owned), each test file runs against the test API started in its variant (the default variant is what `start.sh` gives; another adds its own variables); the script starts each variant itself and leaves the API in the default one. `bash .cuisine/scripts/api-variante.sh <variant>` starts the test API in one variant to debug a file.
- `pnpm --dir api migrate` (applies migrations to `DATABASE_URL`), `migrate:gen` (generates a migration from the Drizzle tables), `migrate:all` (applies to both databases).
- `pnpm --dir api cuisine:openapi <out.json>`: writes the OpenAPI 3 document, identical to what `/api-json` serves, without a running server.
- `pnpm --dir api cuisine:routes <out.json>`: writes the declared access of every route, as a JSON array of `{ method, path, regime, allow, action, customGuards }`: `path` in Express style (`/users/:id`); `regime` is `public`, `auth`, `auth+custom` (a business guard narrows access further, for instance ownership), `undecorated` or `conflict`; `allow` lists the roles admitted among `anonymous`, `user`, `admin` (an admin is admitted wherever a user is, unless the declaration says otherwise); `action` is the declared `<feature>:<action>` or `null`.
- `pnpm --dir api type:check`, `pnpm --dir api test` (unit and integration tests of the API, Jest, against the running test API and `<slug>_test`).
- `pnpm --dir studio type:check`, `pnpm --dir studio build`, `pnpm --dir studio dev` (port 5173, API URL from `VITE_API_URL`, default `http://localhost:4000`).
- `docs/socle.md`: how the foundation is organised and how a business feature plugs into it (access declaration, validation schemas, audit, row-level scopes, imports). Kept current by whoever changes the foundation.

## Data contract
The database schema `base` is fixed by `specifications/socle/data-contract.md` (tables, columns, types, constraints, enums, password hashing). The kitchen and the acceptance suite create accounts directly in these tables. Never rename or drop a contracted column; additions need a dispute.

## Backend conventions
- One folder per feature `api/src/features/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.schemas.ts` (Zod), `<feature>.tables.ts` (Drizzle, schema `base`), `tests/`. Cross-cutting code in `api/src/platform/`.
- Every route declares its access explicitly (public, or authenticated with an action `<feature>:<action>` and roles). The server refuses to start if a route has no declaration (`specifications/socle/98-arbitrages.md`, Q-PLAT-05).
- Every input (body, query, params) and every response is a Zod schema; the OpenAPI document is generated from those schemas, so every bound (lengths, numeric ranges matching the database columns, list sizes, enums, patterns) appears in the contract. Never validate a bound outside the schema.
- Errors: a stable `code` per case, body `{ status, code, message }` (plus `details` for validation), never a stack, SQL or file path.
- A bound added to an existing input or a response change is a breaking change of the contract of record: open a dispute.
- Migrations: edit `*.tables.ts`, then `cd api && pnpm migrate:gen && pnpm migrate:all`.
- Tests: Jest in `api/src/features/<feature>/tests/`, calling the running test API through `@recouvrement/api-client` and seeding with SQL; truncate in `beforeEach`.
- After any API change: restart the server, then `pnpm api-client:generate` at the root.

## Frontend conventions
- `studio/src/app/features/<feature>/{pages,components,hooks}/`; shared code in `studio/src/app/shared/`.
- MUI components, French labels, `<html lang="fr">`; types from `@recouvrement/api-client`.
- Accessible names are part of the specification: use the exact labels of `specifications/socle/70-ecrans.md` (the browser tests select by role and label).

## Specifications and provenance
Every business rule has a stable id `rule-<module>-<slug>` and a provenance tag: `(user)`, `(inferred)`, `(excel: Sheet!Cell)`, `(code)`. Cite the rule id in a comment where it is implemented and in the test that covers it.
