# Coverage - version `socle-tests-ouverts-au-metier`

Acceptance file (black box, HTTP): `acceptance/acceptance-tests-ouverts-au-metier.test.ts`. It reads the document served by `GET /api-json` and the viewer `GET /api` (no authentication, development and test only), plus `specifications/openapi.json` (contract of record) as the reference for the methods of the foundation paths. No test of a previous version is touched.

This version adds no route, no schema, no error code and changes no permission: `specifications/permissions.yaml` is left unchanged (`/api-json` and `/api` are outside the contract and not decorated routes; no operation added or modified, hence no `cross_owner_tests`). The questions file is empty: no `[D-xxxx]` test.

The version creates no new rule id; it changes how existing ones are checked, so that a business module can add paths and words.

| Rule id | Coverage |
|---|---|
| `Q-PLAT-03` (decided) | `acceptance-tests-ouverts-au-metier`: the 16 foundation paths are all keys of `paths` (`arrayContaining`, additions allowed); for each, the served methods include those of the contract of record; no `paths` key contains `/test/`; `components.securitySchemes` contains `bearer` (http bearer) and `cookie` (apiKey in cookie), extra schemes allowed; `GET /api` answers 200. |
| `EXI-PLAT-15` | same tests (paths, methods, no test route, two security schemes). |
| `rule-foundation-no-multi-company` (user) | `acceptance-tests-ouverts-au-metier`: `company\|tenant\|entreprise` (case-insensitive) is absent from the 16 foundation path items and from the `components.schemas` they reach through transitive `$ref`; words in business operations or schemas are not examined. A guard test checks the examined subset is non-empty. Response-level checks of the same rule remain in `acceptance-users-admin`, `acceptance-groups`, `acceptance-scopes`. |

Developers' test `[Q-PLAT-03]` (`api/src/features/auth/tests/auth.test.ts`), replayed: the acceptance file extracts the body of that test from its source and runs it against the served document modified in memory (a fake `call` serves the modified copy; nothing is changed on the API). It must pass on the unmodified document, with an added business path, an added security scheme, and business content mentioning `entreprise`/`tenant`; it must fail when a foundation path is removed, when a `/test/` path is added, and when the `cookie` or the `bearer` scheme is removed. Before the version, the three tolerance cases fail (exact path list, exact scheme list, words forbidden on the whole document), which is what makes these tests non-vacuous.

Not observable through the API:
- The audit of the other foundation tests is below; the replay above covers only `[Q-PLAT-03]`.
- The audit of the other foundation tests (`audit`, `audit-trace`, `audit-mechanism`, `platform`, `users`, `groups`, `imports-api`, `resetData`): internal review of developer tests. Observable counterpart: `resetData` of `acceptance/harness.ts` already truncates every table of `base` read from `pg_tables`, and no acceptance test enumerates routes, tables, audit actions or menu entries exhaustively (inventory of the current suite).
- Menu entries: screens, no studio test in this version.

Assumptions (from the plan): « the foundation » means the 16 paths served today; « no test path » means no `paths` key containing `/test/`; the restriction of `rule-foundation-no-multi-company` to the foundation is `(inferred)`.
