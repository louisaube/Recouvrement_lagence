# Coverage - version `socle-garde-metier-et-reponses-non-json`

**Revision after the red check.** The HTTP file `acceptance/acceptance-garde-metier-reponses-non-json.test.ts` only restated the behaviour of existing routes: all its tests passed before any code, so they verified nothing new. It is retired (reduced to a skipped stub, to be removed with `git rm`); the "Observable" rows below are non-regression duties of the earlier suites, of the contract of record `specifications/openapi.json` and of the developers' before/after `cuisine:openapi` / `cuisine:routes` diff. Every test of the declarations file now fails before the code: former pure-regression assertions (401 without token, `roles: ['admin']` refusal, 400 stays `application/json`, bearer/cookie security, explicit `application/json`) were folded into tests that also assert the new behaviour.

This version adds two declaration capabilities of the platform and no route: `specifications/permissions.yaml` is left unchanged (no operation created or modified, hence no `cross_owner_tests`). `questions.yaml` is `[]`: no `[D-xxxx]` test. No application route adopts either capability (the business module will in a later business version), so the capabilities themselves are exercised only by hidden test routes of the developers (`api/src/platform/tests/`), which the running API does not serve.

| Rule id | Coverage |
|---|---|
| `rule-foundation-existing-routes-unchanged` (user) | Observable. Served document has exactly the operations of the contract of record (none created, none removed); per operation, same response media types per status, same request-body media types, same `security`; same statuses declared; foundation routes still 401 without token, 403 `security.access_denied` for `user` / 200 for `admin` on admin routes, `/auth/current-user` 200 for both roles with `application/json`, health check public, malformed id 400 `api.validation.incoming_failed`, unknown id 404. The `cuisine:openapi` / `cuisine:routes` before/after `diff` is the developers' (test 6 of the plan). |
| `rule-foundation-response-content-type-default` (inferred) | Observable. No response of the served document declares a media type other than `application/json`; the success responses of the main foundation operations are `application/json` only. |
| `rule-foundation-response-content-type-declarative` (inferred) | Partly observable. The existing business export stays declared `application/json` / `string` in the document (no adoption in this version). The platform not writing the header, and `AuditInterceptor.checkResponse` being unchanged, are internal (hidden routes, developers' tests 5 and 5 bis). |
| `rule-foundation-access-guard-only-regime` (inferred) | Only the unchanged part: authenticated routes answer 401 `security.missing_token` / `security.invalid_token` without a valid token. The `roles: []` behaviour (token `user`/`admin` let through, guard decides) is **not observable through the API**: no served route uses `roles: []`; developers' test 1. |
| `rule-foundation-access-undeclared-refused` (user) | Only the unchanged part: the server is running, so every served route is declared; an unknown route is 404 for an admin. The refusal to start is **not observable through the API** (a running server cannot be made to start with an undeclared route); developers' tests 3, 3 bis, 4. |
| `rule-foundation-access-guard-only-route` (user) | **Not observable through the API**: needs a route with `roles: []`, none exists; `cuisine:routes` (`allow: []`) is not an HTTP interface of the running API. Admin-only routes keep refusing `user` and admitting `admin` (regression). Developers' test 2. |
| `rule-foundation-access-no-role-without-guard-refused` (user) | **Not observable through the API**: refusal at start-up, error message in the server log. Developers' tests 3 and 4. |
| `rule-foundation-access-owner-only-needs-role` (inferred) | **Not observable through the API**: refusal at start-up. Developers' tests 3 and 4. |
| `rule-foundation-response-content-type` (user) | **Not observable through the API** for `text/csv` (no route adopts it). Only the guards of the capability's neighbourhood are checked: no `/test/` path in the document, `/api` and `/api-json` still served. Developers' test 5. |
| `rule-foundation-response-content-type-closed-list` (inferred) | **Not observable through the API**: refusal at start-up for a content type outside the list. Developers' test 4. |

## Second file: `acceptance/acceptance-garde-metier-declarations.test.ts` (new behaviour, red before the code)

Since no served route adopts either capability, the new behaviour is not reachable over HTTP. This file calls the public functions of the platform directly (`findAccessProblems`, `describeRoute`, `AccessGuard.canActivate`, `AccessBootCheck.onApplicationBootstrap`, `buildOpenApiDocument`) on synthetic routes built with the real decorators (`Access`, `ApiRoute`): no server, no database. It replaces the "not observable" verdicts above:

| Rule id | Test |
|---|---|
| `rule-foundation-access-guard-only-route` | `roles: []` + guard: no problem, `describeRoute` gives `allow: []`; start-up check accepts it |
| `rule-foundation-access-guard-only-regime` | `AccessGuard` lets `user` and `admin` through with `roles: []`; 401 `security.missing_token` without a user; document carries `bearer` / `cookie` security |
| `rule-foundation-access-no-role-without-guard-refused` | problem `admits no role and no business guard` naming the route; start-up check throws |
| `rule-foundation-access-owner-only-needs-role` | `ownerOnly` + `roles: []` is a problem mentioning `ownerOnly` |
| `rule-foundation-access-undeclared-refused` | undeclared route still reported |
| `rule-foundation-response-content-type` | `text/csv` and `text/csv; charset=utf-8` replace `application/json` under the declared response only |
| `rule-foundation-response-content-type-default` | explicit `application/json` equals no declaration |
| `rule-foundation-response-content-type-closed-list` | `application/xml` stops start-up and names the route; the three admitted values pass |
| `rule-foundation-existing-routes-unchanged` | `roles: ['admin']` still gives `security.access_denied` to `user`; `describeRoute` allow lists for `user`, `admin`, `ownerOnly` and public routes are unchanged |
| `rule-foundation-response-content-type-declarative` | declaring `text/csv` leaves `describeRoute` and the access decision identical, and `AccessGuard` never touches the HTTP response |

Imported modules read `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET` (dummy defaults set by the file when absent).

Assumptions: the contract of record `specifications/openapi.json` is the reference for "existing routes" (it already includes the business operations); the test fails if the served document gains or loses an operation or a media type with respect to it.
