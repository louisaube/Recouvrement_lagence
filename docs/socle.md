# The foundation (socle): what exists and how a business feature plugs into it

This document describes what the code provides **today**. Where a capability of the specification
(`specifications/socle/90-capacites-pour-le-metier.md`) is not built yet, the section says so and does not invent an API:
a business feature must not rely on it until the lot that builds it is green and this document is updated.

## State of the foundation

Lots delivered: `r0-fondations` (platform, authentication, session), `r1-comptes-groupes-perimetres` (accounts, groups,
scopes, row-level rule), `r2-journal-audit` (declarative audit trace, journal routes, `/journal` screen) and
`r3-import` (import mechanism, accounts import, and the generic three-step import journey with the `/utilisateurs/import` screen).

| Capability | State | Where |
|---|---|---|
| Access declaration (`@Public`, `@Access`), refusal by default, boot check | **Provided** | `api/src/platform/access/` |
| Zod validation and OpenAPI contract (`@ApiRoute`, `@Valid*`) | **Provided** | `api/src/platform/validation/`, `openapi/` |
| Errors (`ApiError`, stable codes, exception filter), request id, CORS | **Provided** | `api/src/platform/http/` |
| Authentication: login, current user, logout, bearer token and cookie | **Provided** | `features/auth/`, `platform/security/` |
| Accounts: list, read (self or admin), create, change role and groups | **Provided** (API and screen) | `features/users/` |
| Groups and scopes: list, create, update | **Provided** (API and screens) | `features/groups/`, `features/scopes/` |
| Row-level rule (`scope_code` filter, admin access modes, fail-closed) | **Provided**: `ScopedRepository`, `declareScopedTable`, `adminScopes` enforced | `platform/scopes/` |
| Audit: declarative traced routes (`@Audited`, `@AuditExempt`), atomic entry, pre-delivery check | **Provided**; the seven foundation write routes are traced (login, logout and the import preview are exempted) | `platform/audit/`, `platform/database/transaction-context.ts` |
| Audit journal: `GET /audit-logs`, `GET /audit-logs/filters`, append-only table | **Provided** | `features/audit/`, migration `0001_audit_append_only` |
| Imports (declared columns, preview, errors, confirmation) and the accounts import | **Provided** (API and generic studio journey `studio/src/app/shared/import/`) | `features/imports/`, `features/users/users-import.*` |
| Studio: login, session guard, common layout, provisional home | **Provided** | `studio/src/app/` |
| Studio: administration screens (users, groups, scopes, journal) and the « Accès refusé » guard | **Provided** (`/utilisateurs`, `/groupes`, `/perimetres`, `/journal`, `/utilisateurs/import`, `RequireAdmin`) | `studio/src/app/features/{users,groups,scopes,audit}/`, `specifications/socle/70-ecrans.md` |
| Tests: Jest against the running test API, SQL seeding | **Provided** | `api/src/platform/testing/helpers.ts` |

## Layout

```
api/
  src/main.ts                      boot: Nest app, no body parser (see Validation), request id, CORS, filter, docs
  src/app.module.ts                root module: add the module of every feature to `imports`
  src/platform/                    cross-cutting code (frozen once the foundation is built)
    config/config.ts               api/.env.<NODE_ENV> + Zod validation of the variables, slug of the application
    database/                      pg Pool + Drizzle (global DatabaseModule), `schema.ts` = every table of schema `base`
    http/                          ApiError + stable codes, exception filter, X-Request-Id, CORS, configureApp()
    access/                        @Public / @Access, AccessGuard, RouteCatalog, boot-time check, route report
    validation/                    Zod interceptor (@ValidBody/@ValidQuery/@ValidParams), shared e-mail validator,
                                   common.ts (uuid, `:id` params, pagination query, trimmed name, distinct uuid lists)
    scopes/                        row-level rule: ScopeAccessService, ScopeContextInterceptor, ScopedRepository
    audit/                         @Audited / @AuditExempt, AuditInterceptor (transaction + entry), pre-delivery check, text helpers
    openapi/                       @ApiRoute / @ApiTag, document builder, /api-json + /api (not in production)
    security/                      TokenService (JWT HS256, 24 h), SessionService (bearer, cookie, current user)
    cli/                           cuisine:openapi and cuisine:routes
    testing/helpers.ts             SQL seeding and typed client for the Jest tests (not part of the build)
    tests/platform.test.ts         the platform tests, with a fictitious test-only feature
  src/features/<feature>/          <feature>.module.ts, .controller.ts, .service.ts, .schemas.ts (Zod), .tables.ts, tests/
    server/                        GET /server/health-check
    auth/                          POST /auth/login, GET /auth/current-user, POST /auth/logout
    users/                         GET /users, POST /users, GET /users/:id (self or admin), PATCH /users/:id
    groups/                        GET /groups, POST /groups, PATCH /groups/:id; memberships.ts (lockMemberships, sameId)
    scopes/                        GET /scopes, POST /scopes, PATCH /scopes/:id
    audit/                         GET /audit-logs, GET /audit-logs/filters (read only; entries are written by platform/audit)
    imports/                       the import mechanism: ImportDefinition (types), ImportsService, multipart parser,
                                   upload reception, xlsx inspection, CSV/xlsx readers, error codes; tables (data contract)
    users/users-import.*           the accounts import: definition and its four routes (the model to copy)
  drizzle/                         generated migrations (0000 also creates the schema `base`)
  scripts/migrate.ts               applies the migrations (--all: development and test databases)
  scripts/server/start.sh          build + start in the background + wait for the health check
studio/src/
  main.tsx, app/App.tsx            theme (MUI, French locale), router, session provider; protected routes are added here
  app/features/<feature>/{pages,components,hooks}/
    auth/                          SessionProvider/useSession, RequireSession, AppLayout, LoginPage
    users/, groups/, scopes/       administration pages (`UsersPage`...), their dialogs and loaders (`useUserLoader`...)
    audit/                         JournalPage (`/journal`), useAuditData (list and filter values), auditFilters (address
                                   parameters, day bounds, French verbs and dates)
    home/                          provisional home page
  app/shared/                      api.ts (typed client), labels.ts (role labels), safeRedirect.ts, FullScreenLoading.tsx,
                                   useCall.ts, usePagedList.ts (+ `useAllItems`), notify.tsx (`useNotify`),
                                   components/{AdminList,FormDialog,PageHeader}.tsx, ComingSoonPage.tsx (placeholder page, unused today)
packages/api-client/               typed client generated from the OpenAPI document (`src/schema.d.ts`)
acceptance/                        black-box suite (Jest) and browser tests (Playwright, `e2e/`); read-only for coding agents
specifications/                    functional specification, `permissions.yaml`, contract of record (`openapi.json`)
```

## Commands (the tooling contract)

| Command | Effect |
|---|---|
| `cd api && NODE_ENV=test bash scripts/server/start.sh` | frees port 4000, builds, starts the API, waits for `GET /server/health-check` = 200 (log `api/.server-<env>.log`). Restart after every backend change. |
| `pnpm --dir api migrate` / `migrate:all` / `migrate:gen` | apply to `DATABASE_URL` / to both databases / generate from the Drizzle tables |
| `pnpm --dir api cuisine:openapi <out.json>` | OpenAPI document without a server, identical to `/api-json` (use an absolute path) |
| `pnpm --dir api cuisine:routes <out.json>` | `[{ method, path, regime, allow, action, customGuards }]` for every controller route |
| `pnpm --dir api type:check`, `pnpm --dir api test` | type check; Jest against the running test API and `<slug>_test` |
| `pnpm api-client:generate` (root) | regenerates `packages/api-client/src/schema.d.ts` from `http://localhost:4000/api-json` |
| `pnpm --dir studio type:check` / `build` / `dev` | studio type check / production build / dev server on port 5173 |
| `pnpm acceptance` (root) | black-box acceptance suite (`.cuisine/scripts/acceptance.sh`): each file against the test API started in its variant of `acceptance/variants.yaml`, else against the running API |

Environment: `api/.env.template` lists `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `PORT`, `STUDIO_ORIGINS`;
`.cuisine/bin/cuisine envs` writes `api/.env.development` and `api/.env.test` (git-ignored). When `acceptance/variants.yaml` exists, `api/.env.test` also
holds its default variant (a block written by the kitchen); the other variants are started by the acceptance script with
their own variables added, an empty value meaning absent (`cuisine variantes` lists them and the files of each). The cookie prefix is the
application slug (the `name` of the root `package.json`). `COOKIE_SECRET` and `STUDIO_ORIGINS` are validated but not used
yet: CORS reflects any `Origin`, as the specification requires (EXI-PLAT-17). The studio reads the API URL from
`VITE_API_URL` (default `http://localhost:4000`).

## Declaring a route: access, validation, contract

Every route declares its access **and** its contract. A route without access declaration, or without `@ApiRoute`, makes the
server refuse to start (the error names the route); if an undeclared route ever escaped the check it would answer 401 to a
visitor and 403 to anybody else. A route deliberately kept out of the OpenAPI document (test routes) declares
`@ApiRoute({ hidden: true, responses: {} })`.

```ts
@Controller('widgets')
@ApiTag('Widgets')
export class WidgetsController {
  @Get(':id')
  @Access({ action: 'widgets:get', roles: ['user'] })      // or @Public(), or roles: [] + @UseGuards(...)
  @ApiRoute({
    params: widgetParamsSchema,                             // z.object, one key per :param
    responses: { 200: { description: 'The widget', schema: widgetSchema } },
  })
  get(@ValidParams() params: WidgetParams) { ... }
}
```

Then add the module to `imports` in `api/src/app.module.ts`.

### Access declaration

- `@Public()` or `@Access({ action: '<feature>:<verb>', roles, adminScopes? })`; exactly one per route.
- `roles: ['user']` admits user **and** admin, `['admin']` only admin.
- `roles: []` reserves the route to a business guard (`rule-foundation-access-guard-only-route`): the platform admits no role
  of the foundation, and the `@UseGuards(...)` (on the method or the controller) alone decides. Without a valid token the
  route answers `401`; with one, whatever the role (`user`, `admin`), the platform lets the request through with `req.user`
  set (`rule-foundation-access-guard-only-regime`), before any validation or body reading, and the refusal is the guard's own
  (for instance `403`). `cuisine:routes` reports it as `auth+custom` with `allow: []`; the OpenAPI document carries the
  `bearer` / `cookie` security as for any authenticated route. The server refuses to start for `roles: []` without a guard
  (`Route <route> admits no role and no business guard`, `rule-foundation-access-no-role-without-guard-refused`) and for
  `ownerOnly: true` with `roles: []` (`rule-foundation-access-owner-only-needs-role`). The platform only checks that a guard
  is present, not what it does.
- The action code is unique and checked at boot (`^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`, 1 to 100 characters).
- The guard runs before anything else: `401 security.missing_token` / `security.invalid_token`, then
  `403 security.access_denied`, all before validation and body reading.
- An ownership rule is a `@UseGuards(...)` business guard; `cuisine:routes` reports the route as `auth+custom`. It must run
  before parameter validation and any lookup, and must not reveal whether the object exists.
- `adminScopes` (`'full'` default, `'read'`, `'none'`) is the access of an administrator to the scopes on this route; it is
  enforced by `ScopedRepository` (see Row-level scopes) and has no effect on ordinary users.
- Ownership example: `users/users.guards.ts` (`SelfOrAdminGuard`, used by `GET /users/:id` with `roles: ['user'], ownerOnly: true`; `ownerOnly` makes `cuisine:routes` list only `admin` in `allow`, the access on any id): it runs
  before parameter validation and any lookup, and answers the same `403 security.access_denied` for another existing
  account, an unknown id and a malformed id.
- `specifications/permissions.yaml` holds the expected matrix and is read-only for coding agents: a missing or wrong entry
  for a new route is raised with an `OPEN: permissions <operation>: <reason>` dispute.

### Content type of a response

A response is `application/json` in the OpenAPI document unless it declares otherwise
(`rule-foundation-response-content-type`, `rule-foundation-response-content-type-default`):

```ts
@Post('absences')
@UseGuards(CapabilityGuard('export:run'))           // business guard: required with roles: []
@Access({ action: 'exports:absences', roles: [] })   // no role of the foundation admitted
@ApiRoute({
  responses: { 200: { description: 'CSV file', contentType: 'text/csv; charset=utf-8', schema: z.string() } },
})
```

- Admitted values (closed list, `RESPONSE_CONTENT_TYPES` in `openapi/route-contract.ts`): `application/json`, `text/csv`,
  `text/csv; charset=utf-8`. Any other value makes the server refuse to start (`Route <route> declares an unsupported response
  content type "<x>"`, `rule-foundation-response-content-type-closed-list`); extending the list is a change of the platform.
- The declaration is documentary (`rule-foundation-response-content-type-declarative`): the platform does not write the
  `Content-Type` header, the route does (`res.setHeader`), and it does not validate the response. The one existing check
  stays: a **traced** route (`@Audited`) must return a value that satisfies its first 2xx schema (`AuditInterceptor`), whatever
  its content type, otherwise `500` and no entry; a traced CSV route therefore declares `schema: z.string()` and returns a string.
- Only responses change: request bodies stay `application/json` (or `rawBody`).

### Zod schemas and contract

- Body, query and path parameters are Zod schemas in `<feature>.schemas.ts`, bound with `@ValidBody()`, `@ValidQuery()`,
  `@ValidParams()` and declared in `@ApiRoute({ body, query, params, responses })`. The same schemas generate the OpenAPI
  document, so every bound is written in the schema (`.min/.max/.length/.regex/.int/.uuid`, enums, array sizes,
  `.strictObject` on PATCH to refuse unknown keys). Never validate a bound elsewhere.
- Plain `z.object` strips unknown keys. Name a schema with `.meta({ id: 'FooDto' })` to make it a component.
- Null characters are refused everywhere (400).
- An optional response property (absent from some real responses, such as `user` of `current-user` without session) is
  `.optional()` in the response schema, as `contract-changes.yaml` allows.
- A bound added to an existing input, or a response change, breaks the contract of record: open a dispute. Two
  consequences in lot r1: the pagination query (`paginationQuerySchema`, `common.ts`) declares `from` and `size` as plain
  numbers, as the contract of record does, and applies their range (0 to 2147483647, 1 to 100) as a refinement; and a
  `z.strictObject` PATCH body carries `additionalProperties: undefined` in its `.meta()` so that the document does not
  publish an `additionalProperties: false` the contract of record does not have (the unknown keys are refused all the same).
- Lists are paginated with `from`/`size` (`pageOf(query)`) and sorted in SQL with `byText` / `byLowerText`
  (`platform/database/ordering.ts`, collation `C`): the order does not depend on the server locale.
- A path `:id` is `idParamsSchema` (plain string in the contract, uuid refinement): read it with `@ValidParams()`, never
  with `@Param()`.
- After any API change: restart the server, then `pnpm api-client:generate`.
- **JSON body.** The body parser is disabled at the application level: the validation interceptor reads the JSON (1 MiB limit,
  `413 api.payload_too_large`) after the access guard. A route needing another body type (multipart import) reads its own
  stream and must not use the interceptor body.

### Errors

Body `{ status, code, message }`, plus `details: [{ path, message }]` for validation. Throw
`new ApiError(status, 'domain.reason', 'English message')`; codes are stable `<domain>.<reason>` strings, added and never
renamed.

| Code | Status | Meaning |
|---|---|---|
| `api.validation.incoming_failed` | 400 | invalid input, or a body that cannot be read (malformed JSON, unsupported charset or encoding, aborted request) |
| `api.payload_too_large` | 413 | body over 1 MiB |
| `api.route_not_found` | 404 | unknown route |
| `api.unknown_error` | 500 | any other exception |
| `security.missing_token` / `security.invalid_token` | 401 | no, or invalid or expired, credential |
| `security.invalid_credentials` | 401 | login failure (same body for unknown e-mail and wrong password) |
| `security.invalid_origin` | 400 | cookie login without a usable `Origin` |
| `security.access_denied` | 403 | role not admitted |
| `repository.not_found` | 404 | unknown account, group or scope; also a row outside the caller's scopes (`notFound()`) |
| `users.email_already_exists` | 409 | e-mail already used (`POST /users`) |
| `users.cannot_change_own_role` | 409 | an administrator changes their own role (`PATCH /users/:id`) |
| `groups.name_already_exists` | 409 | group name already used, ignoring case |
| `scopes.code_already_exists` | 409 | scope code already used |
| `scopes.access_denied` | 403 | write aimed at a scope the caller does not reach (`scopeAccessDenied()`) |
| `scopes.read_only` | 403 | administrator write on a route declared `adminScopes: 'read'` (`scopeReadOnly()`) |
| `import.*` | 400, 404, 409, 413 | file import, see the table in « Imports » |
| `audit.misconfigured` | 500 | a route declared `@Audited` without an authenticated access regime (construction error, before any handling) |
| `audit.invalid_descriptor` | 500 | the description of a traced route is out of bounds or throws (construction error; the action is cancelled) |

The cause of a 500 goes to the technical log with the request id, never to the client. A failed Drizzle query is logged by
its PostgreSQL code only, since its message carries the SQL and its parameters. `X-Request-Id` (server-generated UUID) is on
every response and in every technical log line.

### Tables and migrations

Add `<feature>.tables.ts` (schema `base`: `import { base } from '../../platform/database/base-schema'`). `drizzle.config.ts`
picks up every `src/features/**/*.tables.ts`; do not add the file to `platform/database/schema.ts` (frozen, contracted
tables only). Then `cd api && pnpm migrate:gen && pnpm migrate:all`. Inject `@InjectDb() db: Database` for queries; use `db.transaction` for multi-table writes. Never rename
or drop a contracted column (`specifications/socle/data-contract.md`).

## Row-level scopes

A scope (`base.scopes`: `code`, `name`) names a set of data; a group (`base.groups`) gives its members (`group_users`) access
to its scopes (`group_scopes`). The scopes a caller reaches are re-read on every request (first scoped access, memoised for
the request): a change applies from the next request, without reconnection. They are the codes of all the groups of an
ordinary user; an administrator reaches all of them unless the route says otherwise (`adminScopes`, role of the session token).

**Attaching a table.** In `<feature>.tables.ts`, give the table a `scope_code` text not-null column, wrap the table in
`declareScopedTable(...)` (it throws at module load, so the server refuses to start, if the column is missing, not text or
nullable), and in the migration reference `base.scopes(code)` with `on delete restrict on update restrict`:

```ts
export const nurseryChildren = declareScopedTable(
  base.table('nursery_children', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    scopeCode: text('scope_code').notNull().references(() => scopes.code, { onDelete: 'restrict', onUpdate: 'restrict' }),
    ...
  }),
)
```

**Using it.** Inject `ScopedRepository` (global, from `platform/scopes/`) instead of writing filters; it takes the caller from
the request context established by `ScopeContextInterceptor` (an `AsyncLocalStorage`), so nothing is passed around:

| Method | Rule |
|---|---|
| `find`, `count`, `get` | only rows of the scopes reached; `get` answers `404 repository.not_found` for a row elsewhere |
| `insert` (one or many) | every `scope_code` must be writable, else `403 scopes.access_denied` and nothing is written; an administrator with an unknown code gets `400` |
| `update`, `updateOne` | only rows of writable scopes; moving a row to a scope not reached is `403 scopes.access_denied`; `updateOne` is `404` when no row is touched |
| `remove`, `removeOne` | only rows of writable scopes (`remove` returns how many) |
| `upsert` | never modifies a conflicting row of a scope not writable, never changes `scope_code` |

Administrator on a route declared `adminScopes: 'read'`: reads everything, every write is `403 scopes.read_only`; `'none'`:
reads nothing, writes are `403 scopes.access_denied`. Both settings are ignored for ordinary users. An ordinary user with no
group reaches nothing.

**Fail-closed.** Outside a request, or on a public route, no identity is established: reads are empty and writes are refused.
A scheduled task or script that must see data declares it explicitly:
`runWithScopeAccess('full' | 'read' | 'none', () => ...)`.

**By hand.** A join or an aggregate written with Drizzle bypasses the repository: add `await repository.condition(table)` to its
`where`. The column name `scope_code` is imposed and a row belongs to one scope. No notion of company or tenant anywhere.

**Proof.** `platform/tests/scope-row-filter.test.ts` creates its own scoped table (outside the data contract, dropped at the
end) and test-only routes, and checks reads, writes and refusals for a member, a user without group and an administrator in
the three admin modes (Q-PERIM-02).

**Accounts, groups, scopes (admin routes).** `GET/POST /scopes`, `PATCH /scopes/:id` (name only, the code is immutable);
`GET/POST /groups`, `PATCH /groups/:id` (provided fields replace the current values, in one transaction that locks the group
row; the group's existence is checked before the referenced ids); `GET /users`, `POST /users`, `GET /users/:id`,
`PATCH /users/:id` (role and `groupIds` only; an administrator cannot change their own role). Memberships are the same rows
(`group_users`) seen from the account or from the group. No route deletes anything (`404`). These tables are not themselves
scoped: an administrator sees every scope in the administration screens.

**Concurrency of the administration writes.** The account or group row is locked with `for no key update` (it excludes
another modification of the same row but not the foreign key checks of a membership written from the other side), and every
transaction that rewrites memberships first takes `lockMemberships(tx)` (`features/groups/memberships.ts`, a transaction-level
advisory lock): an account rewritten from its screen and a group rewritten from its own never deadlock (no 500). Identifiers
of the path and of the id lists may be written in capitals: they are compared case-insensitively (`uuidList` distinctness,
`sameId`, lower-cased lookup in the `load` of each service), so `PATCH /users/<ID IN CAPITALS>` still answers with the
account and still refuses a change of the caller's own role.

## Audit: tracing a route by declaration

A feature never writes a journal entry. It declares the route as traced, next to its access declaration; the platform
writes the entry (`rule-foundation-audit-declarative-route`). Table `base.audit_logs`: `actor_id`, `actor_email`, `action`,
`object_type`, `object_id`, `scope_code`, `summary`, `occurred_at` (set by the database, to the millisecond).

```ts
@Post()
@Access({ action: 'widgets:create', roles: ['admin'] })        // the action code of the entry is this one
@Audited({
  objectType: 'Widget',                                          // French label, chosen once, never renamed (1-100)
  describe: ({ response, sentFields }) => ({
    objectId: response.widget.id,                                // 1-100 characters, not necessarily a uuid
    scope: response.widget.scopeCode,                            // code of the targeted scope, omit or null if none
    summary: `Création du widget « ${response.widget.name} »`,   // French, 1-500 characters
  }),
})
@ApiRoute({ ... })
```

- `describe` receives `{ body, params, query, sentFields, response, actor }` (validated inputs, names of the sent body
  keys, the value the handler returned, the caller). Build the summary from the **response** and the **names** of the sent
  fields (`fieldNames(sentFields, { name: 'nom', ... })` in `platform/audit/audit-text.ts`), never from raw values: no
  password, token, hash, file content, imported e-mail. `count(n, 'membre')` gives the French agreement (`0 membre`,
  `2 membres`). A deletion route uses the verb `delete` in its action code (`widgets:delete`, shown « Suppression »).
- `AuditInterceptor` (innermost global interceptor) runs a traced route in **one transaction**: it reads the author's
  e-mail (`401 security.invalid_token` if the account no longer exists), runs the handler, checks the response against the
  2xx schema of `@ApiRoute`, validates and normalises the description (whitespace and control characters collapsed,
  trimmed, cut at 500 characters with « … »), then inserts the entry. Any error, 4xx or 5xx, rolls back the action and the
  entry together; only a 2xx leaves an entry. A `PATCH` with `{}` is traced like any accepted request.
- The services need no change: the injected `Database` follows the ambient transaction
  (`platform/database/transaction-context.ts`, `AsyncLocalStorage`), so the `db.transaction(...)` of a service becomes a
  savepoint of it. Do not use the raw pool (`PG_POOL`) from a traced handler: it would escape the transaction.
- Construction errors, to be caught by the feature's tests: `500 audit.misconfigured` (traced route that is not
  authenticated), `500 audit.invalid_descriptor` (out-of-bounds or throwing description, action cancelled).
- **Pre-delivery check.** Every `POST`/`PUT`/`PATCH`/`DELETE` route is traced or carries
  `@AuditExempt('<reason>')` (login, logout, an import preview...); otherwise the server refuses to start, naming the route
  (`findAuditProblems`, run by `AccessBootCheck`). Routes hidden from the contract (test routes) are exempt by nature.
  Reads are never traced.
- Traced today: `POST /users` (`users:create`), `PATCH /users/:id` (`users:update`), `POST /scopes`, `PATCH /scopes/:id`
  (both carry the scope code), `POST /groups`, `PATCH /groups/:id`, and `POST /users/imports/:importId/confirm`
  (`users:import-confirm`, object type « Import de comptes », one entry per import). Exempted: `POST /auth/login`,
  `POST /auth/logout`, `POST /users/imports/preview`.
- **Journal** (`features/audit/`): `GET /audit-logs` (`from`, `size`, `actorId`, `action`, `objectType`, `scope`,
  `occurredFrom`, `occurredTo`; exact filters ANDed; newest first by `occurred_at` then `id`; bounds are instants, included
  to the millisecond) and `GET /audit-logs/filters` (authors with the e-mail of their latest entry, distinct actions, object
  types and scopes, at most 1000 each, computed from the journal only). Administrators only (`audit:list`,
  `audit:filters`). There is no write route: `POST`/`PUT`/`PATCH`/`DELETE` under `/audit-logs` are
  `404 api.route_not_found`. A new traced route appears in the filters without any change.
- **Database protection** (migration `0001_audit_append_only`): triggers refuse `UPDATE` and `DELETE` on `base.audit_logs`
  (`42501`) and `TRUNCATE` except in a database whose name ends with `_test`. The table owner can still drop it or disable
  the triggers; in deployment the application should connect with a role limited to `SELECT` and `INSERT` on this table.
- `actor_id` and `scope_code` have no foreign key and the e-mail is a copy: entries survive the deletion of their author.
- Tests: `features/audit/tests/` (journal routes, traces of the seven routes) and `platform/tests/audit-mechanism.test.ts`
  (the mechanism, with a fictitious traced feature and its own table).

## Imports

Streaming import of `.xlsx` and `.csv` files (`features/imports/`), reusable by any feature, with the accounts import
(`features/users/users-import.*`) as its first use. Contract: §4 of the capabilities document and `60-import.md`.

**Journey.** `GET specification` → `POST preview` (multipart, one part `file`; nothing is created) → `GET :importId/errors`
(pages of `{ row, column, reason }`, by row then by declared column) → `POST :importId/confirm` (creates the valid rows).
A preview lasts 2 hours, belongs to the administrator who sent it (another one, an expired or a consumed preview is
`404 import.preview_not_found`) and is purged by the next preview.

**Declaring an import.** Implement `ImportDefinition` (`imports.types.ts`) as an injectable provider:
- `feature` (key of the feature), `columns` (`name`, `required`, `description`, `parse(cell)` returning the normalised value
  or the French reason; use `echo()` from `imports.text.ts` to quote a faulty value);
- optional `uniqueKey { column, duplicateReason(firstRow) }`: the first row carrying a key keeps it, even if invalid;
- optional `checkBatch(rows, db)`: grouped checks against the database, one query per batch of 1000 rows, never per row;
- `saveBatch(rows, tx)`: registers valid rows inside the transaction of the confirmation, **revalidating** them against the
  current state (a row that became impossible is `skipped`, never an error);
- `scoped: true` when the rows are attached to scopes: the caller's write access to scopes is checked before any byte is
  analysed (`scopes.read_only`, `scopes.access_denied`; `adminScopes` of the route applies as usual).

**Plugging in.** Import `ImportsModule`, then copy `UsersImportController`: `GET specification`, `POST preview`
(`@HttpCode(200)`, `@AuditExempt`, `rawBody: { contentType: 'multipart/form-data', schema: MULTIPART_FILE_BODY }` in
`@ApiRoute`, handler `@Req() req` passed to `ImportsService.preview`), `GET :importId/errors`, `POST :importId/confirm`
(`@HttpCode(200)`, `@Audited`, the entry being written in the same transaction). Choose the action codes
(`<feature>:import-*`), the roles and the object type; add the four operations to the permission matrix by a dispute if
they are missing. `rawBody` is the contract option for a body the validation interceptor must not read.

**Limits and behaviour** (all in `imports.service.ts` / `receive.ts` / `xlsx-inspect.ts`):
- file at most 100 MiB (`413 import.file_too_large`, answered at once from the declared length, connection cut at twice
  the limit), at most 1,000,000 data rows, cells at most 1,000 characters, 1,000 columns; the file goes to a temporary file
  under `os.tmpdir()/cuisine-imports` (emptied at startup and after every request, whatever its outcome), never into memory;
- multipart is read by our own parser (`multipart.ts`, on `streamsearch`) because a file name holding a NUL must be cleaned,
  not refused; the name is reduced to its base name, control characters become spaces, 255 characters at most;
- a workbook is checked before being read (`xlsx-inspect.ts`): encrypted entries, more than 1,000 entries, suspicious names,
  expansion ratio, lying sizes, DOCTYPE/ENTITY, macros and nested archives (`400 import.unsafe_archive`), external links,
  external relationships and external formulas (`400 import.external_links`). Row numbers are the spreadsheet's, found by a
  second scan of the sheet XML because the reader skips rows without cell;
- no double import: the SHA-256 of the file is remembered per feature once confirmed (`409 import.already_imported`,
  also on the preview); confirmation locks the preview row and relies on a unique index, so concurrent confirmations create
  once;
- the rows of a preview are staged in `import_preview_rows` (a unique partial index on the key does the in-file
  deduplication) and removed on confirmation. Imported accounts get a `token` credential holding the hash of random bytes
  (one bcrypt hash per batch, hashing 300,000 secrets one by one would take hours): nobody can log in with it until a
  password is set by other means.

| Code | Status | Meaning |
|---|---|---|
| `import.invalid_file_type` | 400 | extension, signature or encoding not accepted; an empty `.csv` |
| `import.unsafe_archive` | 400 | trapped workbook (see above), also an encrypted entry |
| `import.external_links` | 400 | external link, relationship or formula |
| `import.file_too_large` | 413 | over 100 MiB |
| `import.too_many_rows` | 400 | over 1,000,000 data rows |
| `import.empty_file` | 400 | no data row |
| `import.missing_columns` | 400 | a required column is missing, or a file without header |
| `import.already_imported` | 409 | the same file was already confirmed (preview and confirmation) |
| `import.preview_not_found` | 404 | unknown, foreign, expired or consumed preview |
| `import.aborted` | 400 | the client left during the analysis (nothing is kept) |

**Studio.** `studio/src/app/shared/import/ImportFlow.tsx` is the generic journey (drop, preview with the paginated table of
faults, confirmation dialog, result); it receives an `ImportApi` (`importTypes.ts`: `loadSpecification`, `preview`, `errors`,
`confirm`), the noun of the created objects and the exit link. `features/users/pages/UsersImportPage.tsx` with
`hooks/useUsersImportApi.ts` is the model to copy for another feature: only the four calls, the noun and the link change.
The messages for each refusal code are in `importMessages.ts`. The file is sent untouched in a multipart part `file`
(never read by the browser), and "Annuler" aborts the request so that the API drops the preview.

## Authentication and session

- `POST /auth/login` (200): credentials are checked first (bcrypt hash of `base.credentials`, same 401
  `security.invalid_credentials` body for an unknown e-mail and a wrong password), then `returnToken: true` returns
  `{ token }`; otherwise an `Origin` is required (400 `security.invalid_origin`) and the cookie is set, body `{}`. The login
  e-mail uses the shared validator of Q-COMPTES-02, as a refinement that adds no bound to the contract.
- `GET /auth/current-user`: `{ user: { id, email, role } }`, or `{}` without session; a present but invalid token is 401.
- `POST /auth/logout` (201): expires the cookie of the `Origin` host with exactly the attributes of the login cookie.
- Cookie (Q-AUTH-05): `<slug>-jwt-<host>`, `Max-Age=86400`, `Domain=<host>`, `Path=/`, `HttpOnly`, `SameSite=Strict`,
  `Secure` unless the host is `localhost`.
- `SessionService.authenticate(req)` returns the caller from the bearer token or the cookie (Referer on a reload); the role
  is the one frozen in the token at login (Q-AUTH-04). In a handler, the caller is `req.user` (`@Req() req: ApiRequest`).

## Studio: screens and navigation

Stack: React 18, MUI 6, React Router, French labels, `<html lang="fr">`, types from `@recouvrement/api-client`.

- `studio/src/app/shared/api.ts` exports `api`, the typed client (`credentials: 'include'`, base URL `VITE_API_URL`).
- `SessionProvider` / `useSession()` (`features/auth/hooks`) restores the session with `GET /auth/current-user` (`{}`, 401 or
  network error = not connected) and exposes `state` (`loading` | `anonymous` | `authenticated`), `refresh`, `logout`.
- `RequireSession` shows a full-screen "Chargement…" while the session is checked, then redirects to
  `/connexion?redirection=<path+query>` when anonymous. `safeRedirect.ts` accepts only internal paths.
- `AppLayout` is the common layout: header with the application name (a literal "Recouvrement" in the code; change it when
  naming the application), the user's e-mail, a role chip (`roleLabel` in `shared/labels.ts`) and "Se déconnecter". For
  administrators only, a second bar named "Administration" holds the tabs *Utilisateurs* (`/utilisateurs`), *Groupes*
  (`/groupes`), *Périmètres* (`/perimetres`), *Journal* (`/journal`); the active tab follows the start of the path. The
  tabs lead to the administration routes below; `/utilisateurs/import` is reached from the « Importer des utilisateurs » button of the users screen (no tab).
- `App.tsx` declares the routes: `/connexion` (public), then inside `RequireSession` > `AppLayout` the home `/`, the
  administration routes wrapped in `RequireAdmin` (`/utilisateurs`, `/groupes`, `/perimetres`, `/journal`, plus
  `/utilisateurs/import`): an ordinary user sees « Accès refusé » at the same address and no admin route is called) and a catch-all `*`
  redirecting to `/`.
  A business page is added as a `<Route>` before the catch-all; to replace the home page,
  point `/` at the new page (`rule-foundation-home-replaceable`).
- **Navigation for a business feature.** The only navigation bar is the administrator-only « Administration » bar
  (`ADMIN_TABS` in `AppLayout.tsx`); there is no menu for ordinary users and no registration mechanism. `AppLayout` lives in
  `features/auth/`, which is frozen, so a business feature does not add tabs to it. It reaches its pages through the home
  page (replace `/` with a page of links) and through links between its own pages, and puts `PageHeader` (title and actions)
  at the top of each page. If a persistent business menu is needed, that is a change of the foundation, to be requested
  through a dispute, not made from a feature.
- Administration screens share `shared/components/AdminList.tsx` (table card: loading, error with « Réessayer », empty, server
  pagination 10/25/50), `FormDialog.tsx` (« Annuler » / « Enregistrer », full screen under 600 px), `usePagedList` (pages) and
  `useAllItems` (choice lists loaded in full, 100 per call), and `useCall` (401 ends the session, fixed French messages). A feature's code lives in
  `studio/src/app/features/<feature>/{pages,components,hooks}/`; shared code in `studio/src/app/shared/`.
- Accessible names are part of the specification: use the exact labels of `specifications/socle/70-ecrans.md` (the browser
  tests select by role and label). Errors shown to users are the fixed French messages of that document, never an API
  message. The generic import journey is `shared/import/` (see « Imports »).
- **Journal screen** (`features/audit/`, read only): filters (author, action, object type, scope, « Du » / « Au ») are carried
  by the address (`auteur`, `action`, `type`, `perimetre`, `du`, `au`; invalid values are dropped, other parameters kept; page
  and size are not carried). « Du » / « Au » are whole calendar days of the browser, sent as `occurredFrom` / `occurredTo`
  (`00:00:00.000` and `23:59:59.999`, ISO UTC); an inverted period makes no call. The filter values come from
  `GET /audit-logs/filters`, loaded once. Entries are rendered as plain text. A new traced route needs no change here: its
  verb is translated by `actionVerb` (`create`, `update`, `delete`, `import-confirm`, raw suffix otherwise).

## Checklist: adding a business feature

1. `api/src/features/<feature>/` with module, controller, service, `schemas.ts`, `tables.ts`, `tests/`; add the module to
   `api/src/app.module.ts`.
2. Every route: `@Public()` or `@Access({ action, roles })`, `@ApiRoute({ ... })`, schemas bound with `@Valid*`.
3. Every `POST`/`PUT`/`PATCH`/`DELETE`: `@Audited({ objectType, describe })` or `@AuditExempt('<reason>')`.
4. Data of a scope: `declareScopedTable` and `ScopedRepository`; errors as `ApiError` with a `<domain>.<reason>` code.
5. `pnpm --dir api migrate:gen && pnpm --dir api migrate:all`; restart the API; `pnpm api-client:generate`.
6. Studio: `studio/src/app/features/<feature>/{pages,components,hooks}/`, a `<Route>` in `App.tsx`, labels from
   `70-ecrans.md`, calls through `useCall`.
7. Tests in `tests/` citing the rule ids; contest a permission or the contract only by a dispute.

## Tests

- **API (Jest)**: `api/src/features/<feature>/tests/*.test.ts`. Start the test API (`NODE_ENV=test bash
  scripts/server/start.sh`), then `pnpm --dir api test` (runs in band; refuses a database whose name does not end with
  `_test`). Tests call the running API through the typed client (`client()`, `login()`, `call()`, `setCookies()` from
  `platform/testing/helpers.ts`), seed with SQL (`createUser`, `sql`) and call `resetData()` (truncate every table of `base`)
  in `beforeEach`. Cite the rule ids in test titles.
- **Fictitious feature**: `platform/tests/platform.test.ts` mounts a test-only controller in-process, with routes of every
  access regime. Test routes and tables never ship and stay out of the contract (`hidden: true`).
- **Imports**: `features/imports/tests/` holds `import-reading.test.ts` (multipart reader, file names, CSV and sheet readers,
  external formulas; no server), `imports-api.test.ts` (the four routes against the running API) and
  `imports-scoped.test.ts` (a fictitious scoped import mounted in-process, with its own table).
- **Acceptance** (`acceptance/`, `pnpm acceptance`) and **browser tests** (`acceptance/e2e/`, Playwright): owned by QA; to
  contest one, append an `OPEN:` line to the `DISPUTES.md` of the current plans folder.

## Module recouvrement, lot v1a (referential)

How the first lot of the module plugs into the foundation (no foundation file was changed):

- **Features**: `cases` (read routes, `CaseStateService` = the only writer of `cases.state` and of the history,
  `ClockService` = the Paris date), `policies` (versioned policy, six activation checks, witnesses run by
  `@gorules/zen-engine`), `recovery-imports` (the five pivot files), `disputes` (read routes), `decision-queue` (tables and
  `QueueService`, no route yet), `recovery-common` (Zod helpers, `textArray`/`uuidArray` for raw SQL arrays, `isoInstant`).
  Profiles come from `profiles` (`RequireProfile('supervisor' | 'litigation')`, guard before validation: 403 before 400).
- **Raw queries**: results are read from `db.execute(sql…).rows`; bigint columns come back as strings (`Number(...)`), instants
  as strings (`isoInstant`). A JS array is not a single parameter: use `textArray` / `uuidArray`.
- **Imports**: Contacts, Documents and Disputes use `ImportsService` with an `ImportDefinition` each
  (`row-import-definitions.ts`); the facade `RecoveryImportsService` completes the confirmation in the same transaction
  (replacement of the contacts and documents through the `last_import_id` marker; author and states for the disputes) and puts
  the error rows back, since the foundation drops them at the confirmation and the result screen still lists them. Receivables
  and Payments are refused as a whole at the first fault (`WholeFileImportService`, which reuses the foundation's reception and
  preview tables); their confirmation rebuilds the lettrage (`LettrageService`) and recomputes the states.
- **One confirmation route, five audit object types**: `POST /recovery-imports/:type/:importId/confirm` is one action
  (`recovery-imports:confirm`); its `@Audited` declaration has a getter `objectType` that reads the type set around the request
  by `ImportTypeMiddleware` (AsyncLocalStorage), because the platform reads the declaration before and after the handler.
- **States**: a state is derived from the facts (settled, transferred, frozen, supervisor queue, committed, negotiating, open)
  and written only through `CaseStateService.recomputeMany`; the history is append-only. The referential gained the transition
  `supervisor_queue → frozen` (a dispute opened on a case waiting for the supervisor).
- **Tests**: `recovery-common/tests/support.ts` builds accounts with a profile, CSV uploads, a receivables file and a minimal
  policy file.

## Module recouvrement, lot v1b (daily batch)

How the second lot plugs in (no foundation file was changed; `features/cases` and `features/policies` gained one export each):

- **Features**: `brain` (no route: `BrainService.evaluateMany` = prescription, amount threshold, then the state of each case;
  `DecisionJournal` = the append-only `decisions`; `offers.ts` prices the anchor in integer cents; `active-policy.ts` reads the
  active version) and `batches` (5 routes, profile `supervisor`). `BatchPreparationService.prepare` does everything in the
  transaction of the traced route: replace a blocked batch of the day, evaluate every non final case, decide the action of the
  day with the JDM table (`PolicyEngineService.evaluateMany`, graph loaded once), journal each decision, open the
  `transfer_proposed` items, build the orders, run the four checks, set the status (`ready` when all pass, else `blocked`).
- **Tables** (`batches.tables.ts`): `daily_batches` (unique partial index on `batch_date` where status is not `replaced`) and
  `send_orders` (column `kind`; unique partial index on case, kind and `order_date` where status is not `cancelled`: the
  database refuses a duplicate). The orders of a blocked batch are `blocked` until the supervisor releases it.
- **Orders** carry `conditions` as `[{ name, value }]` only (amounts as decimal euros `1000,00`, ISO dates), never a text.
  The eligibility, channel and interlocutor choice are pure functions in `order-builder.ts`; the shares and the automatic stop
  in `batch-checks.ts`; the only numeric constants (3 sigma, 20 batches, 10 batches, channel and role order) in
  `batches.constants.ts`.
- **Not in this lot**: the exposure ceiling and the confirmation order of a commitment need the commitments (lot of the agent
  tools); the table `send_orders` already allows `commitment_confirmation`.

## Known deviations and open points

Lot v1b: see `specifications/recouvrement/implementation-plans/v1b-lot-du-jour/DISPUTES.md` (three acceptance tests of the lot
contradict the specification or a frozen file; two tests wait for the routes of the agent tools).

Lot v1a: see `specifications/recouvrement/implementation-plans/v1a-referentiel/DISPUTES.md` (open: the acceptance policy tests
share and mutate one document object).

`specifications/socle/DISPUTES.md` (all arbitrated): `POST /users` exists from lot r0 because `acceptance-session.test.ts`
requires its 401 / 403; it keeps the component names of the contract of record (`UsersCreateParamsDto`,
`UsersCreateResponseDto`, `UserDto`, `GroupRefDto`) and lot r1 completes the accounts feature around it. The `current-user`
and `login` response schemas are optional (see above); `services` of the health check declares `postgres`. `/api` and
`/api-json` are mounted on the HTTP adapter, outside the controllers, so `cuisine:routes` does not list them.
