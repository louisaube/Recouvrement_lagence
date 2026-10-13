# Coverage - version `socle-groupes-perimetres`

Acceptance files (black box, HTTP + SQL seeding): `acceptance-scopes.test.ts`, `acceptance-groups.test.ts`, `acceptance-users-admin.test.ts`; shared helper `scope-helpers.ts`. Previous suites are unchanged. Operations are listed in `specifications/permissions.yaml` (GET /users and GET /users/:id arbitrated, PATCH /users/:id, /scopes and /groups added; `POST /users` stays admin only in `.cuisine/permissions-foundation.yaml`).

Note on the existing foundation suite: `acceptance-auth.test.ts` (previous version, untouched) only uses `GET /users` as admin, which still works.

Legend: API = covered by an acceptance test; UI = studio behaviour; "not observable" = no HTTP route exposes it to a black-box test.

| Rule id | Prov. | Coverage |
|---|---|---|
| `rule-foundation-scope-definition` | user | API: `acceptance-scopes` (create/list shape `id, code, name`, name trimmed, persisted). |
| `rule-foundation-scope-code-unique` | user | API: `acceptance-scopes` POST (409 `scopes.code_already_exists`, 4 parallel creations = one 201 + three 409, no 500). |
| `rule-foundation-scope-code-format` | inferred | API: `acceptance-scopes` POST (1/50-char codes, 100-char name, uppercase/space/accent/leading `-`/`_`/dot/empty/51 chars, name empty/blank/101, missing fields, wrong types). |
| `rule-foundation-scope-code-immutable` | inferred | API: `acceptance-scopes` PATCH (`code` or any extra key gives 400, scope unchanged). |
| `rule-foundation-scope-no-delete` | inferred | API: `acceptance-scopes` (`DELETE /scopes/:id` and `/scopes` answer 404, scope kept). |
| `rule-foundation-scopes-admin-screen` | user | API: `acceptance-scopes` (admin nominal, user 403 `security.access_denied`, anonymous 401 on the three routes, malformed id 400, unknown id 404). |
| `rule-foundation-group-definition` | user | API: `acceptance-groups` (list ordering: groups by name ignoring case, members by e-mail, scopes by code; create with members and scopes; update name only / members only / scopes only / all; sets replaced). |
| `rule-foundation-groups-admin-screen` | user | API: `acceptance-groups` (403/401 on list, create, update; 404 unknown id; 400 malformed id). |
| `rule-foundation-group-needs-scope` | user | API: `acceptance-groups` (empty or missing `scopeIds` 400 on create and update, duplicates, unknown ids, 201 scopes; nothing persisted / group unchanged). |
| `rule-foundation-group-members-optional` | inferred | API: `acceptance-groups` (`userIds` `[]` or absent on create; `[]` on update removes all; 1001 ids rejected). |
| `rule-foundation-group-name-unique` | inferred | API: `acceptance-groups` (case-insensitive 409 `groups.name_already_exists` on create and update, atomicity of the 409, own name recased accepted, parallel creations no 500). |
| `rule-foundation-group-no-delete` | inferred | API: `acceptance-groups` (`DELETE /groups/:id` answers 404, group kept). |
| `rule-foundation-users-admin-screen` | user | API: `acceptance-users-admin` (POST and PATCH /users: admin only, user 403, anonymous 401; PATCH 404/400 on id). The screen itself is UI. |
| `rule-foundation-user-groups-membership` | user | API: `acceptance-users-admin` (create with 0/1/2 groups, replace, `[]` clears, atomic failure on unknown group, consistency between user side and group side, new account logs in and reads its groups). |
| `rule-foundation-users-list-admin-only` | user | API: `acceptance-users-admin` GET /users (admin list sorted by e-mail with groups sorted by name; user 403; anonymous 401). |
| `rule-foundation-users-get-self-or-admin` | user | API: `acceptance-users-admin` GET /users/:id (own account with groups; another existing, admin, unknown UUID and malformed id all 403 for a user with the same code; admin any account, 404 unknown, 400 malformed; anonymous 401). Cross-owner tests are named in `permissions.yaml`. |
| `rule-foundation-user-create-fields` | inferred | API: `acceptance-users-admin` POST (e-mail 254 accepted / 255 rejected, password 7/8/72/73, invalid role/e-mail, missing fields, groupIds duplicates/malformed/101). |
| `rule-foundation-user-email-unique` | inferred | API: `acceptance-users-admin` POST (409 `users.email_already_exists`, no membership left, 4 parallel creations = one 201 + three 409). |
| `rule-foundation-user-edit-scope` | inferred | API: `acceptance-users-admin` PATCH (`email`, `password`, `id`, unknown keys give 400 and nothing changes, password still works; empty body 200; invalid role / groupIds 400). |
| `rule-foundation-user-own-role-locked` | inferred | API: `acceptance-users-admin` PATCH (admin changing own role 409 `users.cannot_change_own_role`, groups not applied; same role accepted; groups-only edit accepted). |
| `rule-foundation-user-no-delete` | inferred | API: `acceptance-users-admin` (`DELETE /users/:id` answers 404, account kept). |
| `rule-foundation-scope-row-filter` | user | not observable through the API: the foundation exposes no business table with a `scope_code` column and no route reading one; the mechanism lives in repositories. The only route able to exercise it is the test-only `/test/scoped-items` controller, which exists only under `NODE_ENV=test`, is not part of the API contract, and whose payloads the specification does not define; it is covered by the developers' `ScopedRepository.test.ts` / `ScopedRoutes.test.ts`. The inputs of the mechanism (groups, memberships, group scopes) are covered above. |
| `rule-foundation-user-no-group-no-data` | user | not observable through the API (same reason as the row filter: no route returns scoped rows). Observable precondition covered: an account with no group has `groups: []` (`acceptance-users-admin`). |
| `rule-foundation-admin-scope-access` | user | not observable through the API: `@Auth({ adminScopeAccess })` has no effect on any production route and does not change OpenAPI; only the test-only controller variants (`full`, `read`, `none`) can show it. |
| `rule-foundation-scope-fail-closed` | inferred | not observable through the API: concerns repositories used outside a request or on public routes; no production route is scoped. |
| `rule-foundation-no-multi-company` | user | API part: responses of scopes, groups and users carry exactly the specified fields (no company/tenant property), checked in the three suites. Absence in OpenAPI parameters is checked by the developers' `NoMultiCompany.test.ts`. Absence on screens is UI. |
| `rule-foundation-list-pagination` | user | API part: `from`/`size` bounds (0, 101, negative, non numeric, decimal), default size 10, size 100 accepted, `total`, on `GET /scopes`, `/groups`, `/users`. Pagination controls are UI. |
| `rule-foundation-french-ui` | user | not observable through the API: French texts of the screens. |
| `rule-foundation-role-label` | inferred | not observable through the API: labels « Utilisateur » / « Administrateur » (the API returns `user` / `admin`, checked in `acceptance-users-admin`). |
| `rule-foundation-admin-nav` | user | not observable through the API: navigation entries of the layout. |
| `rule-foundation-admin-screens-guard` | user | API part: the three admin areas answer 403 to an ordinary user and 401 to anonymous (see the admin-screen rules). The screen guard and redirect are not observable through the API (UI). |
| `rule-foundation-api-failure-handling` | inferred | not observable through the API: how the studio displays API failures. The API-side error codes are covered in each suite. |

Assumptions made by the tests (taken from the module plan, not contradicted by the requests): error bodies expose `code` (as in `acceptance-auth.test.ts`); refusal of a role is `403 security.access_denied`; ordinary-user lookups of another account answer the same 403 before any id validation; tables are `base.scopes`, `base.groups`, `base.group_users`, `base.group_scopes`, `base.credentials` with snake_case columns (`group_id`, `user_id`, `scope_id`, `created_at`, `updated_at`), used only for seeding and for checking atomicity.
