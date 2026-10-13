# Coverage - version `socle-bearer-rfc6750`

Acceptance file (black box, HTTP): `acceptance/acceptance-bearer-rfc6750.test.ts`, with the raw-HTTP helper `raw` of `acceptance/renfort-helpers.ts` (header values reach the server untouched). Adapted test of a previous version, as the request requires: `acceptance/acceptance-renfort-token.test.ts` (the case « Bearer + deux espaces + <jeton> », which demanded 401, is removed; the tab case stays) and the mention of "two spaces" in `acceptance/COVERAGE-socle-renfort-recette.md`. No other test of a previous version is touched.

This version adds no route, no schema, no error code and changes no permission: `specifications/permissions.yaml` is left unchanged (no operation added or modified; ownership is `none` for the exercised operations `GET /auth/current-user` and `GET /users`, hence no `cross_owner_tests`).

The version creates no new rule id; it changes the observable behaviour of existing ones.

| Rule id | Coverage |
|---|---|
| `rule-foundation-session-expired` | `acceptance-bearer-rfc6750`: accepted (200 with the right user, on `GET /auth/current-user` and `GET /users`): `Bearer` + 1, 2, 3, 10 spaces + token, `bearer`/`BEARER` with several spaces. Refused (401 `security.invalid_token`, body limited to `status`/`code`/`message`, on both routes, valid token): tab, space+tab, tab+space, two spaces+tab, U+00A0, space+U+00A0 between the word and the token; text, second token (identical or not), after the token, separated by spaces or a tab; other prefix (`Basic`, `Token`, `Bearerx`) with several spaces; `Bearer` glued to the token; bare token; `Bearer` alone; `Bearer` + spaces only (trailing blanks are stripped by the HTTP parser, so equivalent to `Bearer`). Invalid or truncated token behind several spaces: 401, never ignored. A refused form or an invalid token behind several spaces is not rescued by a valid cookie. |
| `rule-foundation-session-persists` | `acceptance-bearer-rfc6750`: with several spaces the bearer token prevails over the cookie of another account; without header `GET /auth/current-user` answers `200 {}` and `GET /users` 401. Cookie behaviour itself stays covered by `acceptance-renfort-token`. |
| `rule-foundation-users-list-admin-only` | `acceptance-bearer-rfc6750`: used as anchor of the non-regression of rights: simple user with several spaces gets 403, admin gets 200 on `GET /users`. |

Not observable through the API: the unit tests of `SessionService.tokenSource` (`api/src/platform/tests/`) and the internal comment/regular expression; leading and trailing blanks of the header value (removed by the HTTP parser before the application, accepted contest of `socle-renfort-recette`); vertical tab, form feed and other control characters (the HTTP client refuses to send them). Absence of an audit trace on a 401 is not asserted.

Assumptions (from the plan): the case of the word `Bearer` is indifferent (asserted for `bearer` and `BEARER` with several spaces); the token contains no blank; the word followed by a tab or another non-space blank stays refused even if spaces follow.
