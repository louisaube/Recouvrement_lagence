# Coverage - version `socle-connexion`

Acceptance file: `api/acceptance/acceptance-session.test.ts` (black box, through HTTP). Existing suite `acceptance-auth.test.ts` is unchanged.

This version adds no route and changes no permission (`POST /auth/login`, `GET /auth/current-user`, `POST /auth/logout` are already in `.cuisine/permissions-foundation.yaml`), so `specifications/permissions.yaml` gets no new operation and no `cross_owner_tests` (ownership `none` everywhere). Logout being public is checked by the test "a user, an administrator and an anonymous caller can all log out".

Legend: API = covered by an acceptance test; UI = studio behaviour, not observable through the API (covered by the studio tests listed in the page plans).

| Rule id | Prov. | Coverage |
|---|---|---|
| `rule-foundation-logout` | inferred | API: tests in `POST /auth/logout` (expiring `Set-Cookie` with same name/Domain/Path/HttpOnly/SameSite as login, other hostname, no cookie and no Origin = 200 and no cookie, idempotence, all roles, account kept, session gone once the browser drops the cookie). Note: the JWT is stateless; the test applies the browser behaviour (expired cookie removed) and does not require server-side revocation of an already issued token. The UI part (button, return to `/connexion`) is UI. |
| `rule-foundation-session-persists` | user | API: tests in `POST /auth/login with a browser Origin` (httpOnly cookie named after the Origin hostname, 24 h, `current-user` with cookie, Referer instead of Origin, per-user identity, CORS credentials with reflected origin, token mode unchanged) and the post-logout test. Reload behaviour in the browser is UI. |
| `rule-foundation-login-single-error` | user | API part: unknown e-mail and wrong password give the identical 401 `security.invalid_credentials`, malformed or empty e-mail gives 400, no cookie on failure. The single displayed message « Identifiants incorrects. » is UI. |
| `rule-foundation-session-expired` | inferred | API: absent session gives 200 without user, invalid or tampered cookie token gives 401 (`security.invalid_token`). The studio treating this as "not logged in" is UI. |
| `rule-foundation-protected-redirect` | user | API part only: `current-user` answers 200 without user when not logged in (the signal for the redirect). Redirect itself is UI. |
| `rule-foundation-layout-header` | user | API part only: `current-user` provides id, e-mail and role (user and admin). Header rendering is UI. |
| `rule-foundation-role-label` | inferred | API part only: `current-user` returns role `user` / `admin`. Labels « Utilisateur » / « Administrateur » are UI. |
| `rule-foundation-home-welcome` | user | API part only: `current-user` returns the e-mail displayed. Page content is UI. |
| `rule-foundation-no-self-signup` | user | API: anonymous and simple user get 401/403 on `POST /users`, no public registration route (guessed paths answer an error and create nothing). The absence of a link on the screen is UI. |
| `rule-foundation-no-password-reset` | user | API: no password reset route (guessed paths answer an error, password unchanged). The absence of a link is UI. |
| `rule-foundation-login-screen` | user | Rule not observable through the API: login screen (e-mail and password fields, button, title). |
| `rule-foundation-french-ui` | user | Rule not observable through the API: French texts of the studio. |
| `rule-foundation-login-redirect-home` | inferred | Rule not observable through the API: navigation after login to `redirection` or `/`. |
| `rule-foundation-login-already-connected` | inferred | Rule not observable through the API: redirect from `/connexion` when already logged in. |
| `rule-foundation-login-submit-guard` | inferred | Rule not observable through the API: empty-field guard and double submit prevention in the form. |
| `rule-foundation-no-protected-flash` | inferred | Rule not observable through the API: « Chargement… » and no protected content before `current-user` answers. |
| `rule-foundation-api-unreachable` | inferred | Rule not observable through the API: studio behaviour when the API is down. |
| `rule-foundation-home-replaceable` | user | Rule not observable through the API: the home page has no feature and calls no API. |

Guessed-route tests (`no-self-signup`, `no-password-reset`) assert only "status >= 400 and nothing created", since the specification does not name such routes.
