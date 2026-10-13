import { api, sql, resetData, createUser, login, closePool, API_URL } from './harness'

const client = (token?: string): any => api(token) as any

const expectError = (p: Promise<unknown>, status: number, code?: string) =>
  expect(p).rejects.toMatchObject({ status, ...(code ? { code } : {}) })

const PASSWORD = 'Passw0rd!x'
const STUDIO_ORIGIN = 'http://localhost:4200'
const COOKIE_PREFIX = 'recouvrement-jwt-'

type ParsedCookie = { name: string; value: string; attrs: Record<string, string> }

function parseSetCookie(line: string): ParsedCookie {
  const [pair, ...rest] = line.split(';').map((s) => s.trim())
  const eq = pair.indexOf('=')
  const attrs: Record<string, string> = {}
  for (const part of rest) {
    const i = part.indexOf('=')
    if (i === -1) attrs[part.toLowerCase()] = ''
    else attrs[part.slice(0, i).toLowerCase()] = part.slice(i + 1)
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs }
}

function sessionCookies(res: Response): ParsedCookie[] {
  const lines: string[] = (res.headers as any).getSetCookie?.() ?? []
  return lines.map(parseSetCookie).filter((c) => c.name.startsWith(COOKIE_PREFIX))
}

function isExpiring(c: ParsedCookie): boolean {
  if (c.attrs['max-age'] !== undefined && Number(c.attrs['max-age']) <= 0) return true
  if (c.attrs['expires'] !== undefined) return new Date(c.attrs['expires']).getTime() <= Date.now()
  return false
}

async function call(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}

/** Browser-like login: Origin header, cookie session, no token in the body. */
async function browserLogin(email: string, password: string, origin = STUDIO_ORIGIN) {
  const res = await call('/auth/login', {
    method: 'POST',
    headers: { origin },
    body: { email, password, returnToken: false },
  })
  const cookies = sessionCookies(res)
  return { res, cookie: cookies[0], cookies }
}

const cookieHeader = (c: ParsedCookie) => `${c.name}=${c.value}`

// Acceptance of the version `socle-connexion`: session cookie, logout, login errors, access to the home identity.
// The studio rules (screens, layout, redirects) are not observable through the API; see COVERAGE-socle-connexion.md.
describe('Socle connexion - session and logout', () => {
  beforeEach(async () => {
    await resetData()
  })
  afterAll(async () => {
    await closePool()
  })

  describe('POST /auth/login with a browser Origin (cookie session)', () => {
    it('[rule-foundation-session-persists] returns an empty object and sets an httpOnly session cookie named after the Origin hostname', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { res, cookies } = await browserLogin('a@example.com', PASSWORD)
      expect(res.status).toBeLessThan(300)
      expect(await res.json()).toEqual({})
      expect(cookies).toHaveLength(1)
      const c = cookies[0]
      expect(c.name).toBe('recouvrement-jwt-localhost')
      expect(c.value.length).toBeGreaterThan(10)
      expect(c.attrs['httponly']).toBeDefined()
      expect(c.attrs['samesite']?.toLowerCase()).toBe('strict')
      expect(c.attrs['domain']).toBe('localhost')
      expect(c.attrs['path']).toBe('/')
    })

    it('[rule-foundation-session-persists] the cookie lasts about 24 hours', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD)
      const seconds =
        cookie.attrs['max-age'] !== undefined
          ? Number(cookie.attrs['max-age'])
          : (new Date(cookie.attrs['expires']).getTime() - Date.now()) / 1000
      expect(seconds).toBeGreaterThan(23 * 3600)
      expect(seconds).toBeLessThanOrEqual(24 * 3600 + 60)
    })

    it('[rule-foundation-session-persists] the cookie name and domain follow the hostname of the Origin, port excluded', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD, 'http://localhost:5173')
      expect(cookie.name).toBe('recouvrement-jwt-localhost')
      expect(cookie.attrs['domain']).toBe('localhost')
    })

    it('[rule-foundation-session-persists] with the session cookie and an Origin, GET /auth/current-user returns the logged-in user', async () => {
      const u = await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD)
      const res = await call('/auth/current-user', {
        headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(cookie) },
      })
      expect(res.status).toBe(200)
      const body: any = await res.json()
      expect(body.user).toMatchObject({ id: u.id, email: 'a@example.com', role: 'user' })
    })

    it('[rule-foundation-session-persists] the session is still recognised on a later request (page reload) with Referer instead of Origin', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD)
      const first = await call('/auth/current-user', {
        headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(cookie) },
      })
      const reload = await call('/auth/current-user', {
        headers: { referer: `${STUDIO_ORIGIN}/`, cookie: cookieHeader(cookie) },
      })
      expect(reload.status).toBe(200)
      const a: any = await first.json()
      const b: any = await reload.json()
      expect(b.user.id).toBe(a.user.id)
    })

    it('[rule-foundation-session-persists] each cookie identifies its own user', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await createUser({ email: 'b@example.com', password: 'Other-Passw0rd!', role: 'admin' })
      const a = await browserLogin('a@example.com', PASSWORD)
      const b = await browserLogin('b@example.com', 'Other-Passw0rd!')
      const ra: any = await (
        await call('/auth/current-user', { headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(a.cookie) } })
      ).json()
      const rb: any = await (
        await call('/auth/current-user', { headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(b.cookie) } })
      ).json()
      expect(ra.user).toMatchObject({ email: 'a@example.com', role: 'user' })
      expect(rb.user).toMatchObject({ email: 'b@example.com', role: 'admin' })
    })

    it('[rule-foundation-session-persists] CORS lets the studio send the cookie: the Origin is reflected (never *) and credentials are allowed', async () => {
      const res = await call('/auth/current-user', { headers: { origin: STUDIO_ORIGIN } })
      expect(res.headers.get('access-control-allow-origin')).toBe(STUDIO_ORIGIN)
      expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    })

    it('[rule-foundation-session-persists] a login without cookie session (token requested) still works as before', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const res = await call('/auth/login', {
        method: 'POST',
        body: { email: 'a@example.com', password: PASSWORD, returnToken: true },
      })
      expect(res.status).toBeLessThan(300)
      const body: any = await res.json()
      expect(typeof body.token).toBe('string')
    })
  })

  describe('GET /auth/current-user (identity shown by the layout and the home page)', () => {
    it('[rule-foundation-protected-redirect][rule-foundation-session-expired] without session it answers 200 with no user (the studio then goes to the login screen)', async () => {
      const res = await call('/auth/current-user', { headers: { origin: STUDIO_ORIGIN } })
      expect(res.status).toBe(200)
      const body: any = await res.json()
      expect(body.user).toBeUndefined()
    })

    it('[rule-foundation-layout-header][rule-foundation-home-welcome] returns the e-mail of a user with id, email and role', async () => {
      const u = await createUser({ email: 'alice@example.com', password: PASSWORD, role: 'user' })
      const token = await login('alice@example.com', PASSWORD)
      const { data } = await client(token).GET('/auth/current-user')
      expect(data.user).toEqual({ id: u.id, email: 'alice@example.com', role: 'user' })
    })

    it('[rule-foundation-layout-header][rule-foundation-role-label] returns the role admin for an administrator', async () => {
      await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
      const token = await login('boss@example.com', PASSWORD)
      const { data } = await client(token).GET('/auth/current-user')
      expect(data.user).toMatchObject({ email: 'boss@example.com', role: 'admin' })
    })

    it('[rule-foundation-session-expired] a session cookie holding an invalid token answers 401 security.invalid_token', async () => {
      const res = await call('/auth/current-user', {
        headers: { origin: STUDIO_ORIGIN, cookie: `${COOKIE_PREFIX}localhost=invalid.token.value` },
      })
      expect(res.status).toBe(401)
      expect(JSON.stringify(await res.json())).toContain('security.invalid_token')
    })

    it('[rule-foundation-session-expired] a session cookie holding a tampered token answers 401', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD)
      const tampered = cookie.value.slice(0, -3) + (cookie.value.endsWith('aaa') ? 'bbb' : 'aaa')
      const res = await call('/auth/current-user', {
        headers: { origin: STUDIO_ORIGIN, cookie: `${cookie.name}=${tampered}` },
      })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /auth/logout', () => {
    // The logout status is unchanged by this version (plan 3.1: "status unchanged, OpenAPI unchanged"): the
    // contract of record documents 201 (Nest default for POST).
    it('[rule-foundation-logout] answers 201 (status unchanged) and expires the session cookie with the same name, Domain and Path as at login', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie: loginCookie } = await browserLogin('a@example.com', PASSWORD)
      const res = await call('/auth/logout', {
        method: 'POST',
        headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(loginCookie) },
      })
      expect(res.status).toBe(201)
      const cleared = sessionCookies(res)
      expect(cleared).toHaveLength(1)
      const c = cleared[0]
      expect(c.name).toBe(loginCookie.name)
      expect(c.attrs['domain']).toBe(loginCookie.attrs['domain'])
      expect(c.attrs['path']).toBe(loginCookie.attrs['path'])
      expect(isExpiring(c)).toBe(true)
      expect(c.value).toBe('')
    })

    it('[rule-foundation-logout] the expiring cookie carries the same HttpOnly and SameSite attributes as the login cookie', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie: loginCookie } = await browserLogin('a@example.com', PASSWORD)
      const res = await call('/auth/logout', {
        method: 'POST',
        headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(loginCookie) },
      })
      const c = sessionCookies(res)[0]
      expect(c.attrs['httponly']).toBeDefined()
      expect(c.attrs['samesite']?.toLowerCase()).toBe('strict')
      expect(c.attrs['secure']).toBe(loginCookie.attrs['secure'])
    })

    it('[rule-foundation-logout] logout expires the cookie for another Origin hostname with that hostname as name and Domain', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const origin = 'http://app.example.com:3000'
      const { cookie: loginCookie } = await browserLogin('a@example.com', PASSWORD, origin)
      const res = await call('/auth/logout', {
        method: 'POST',
        headers: { origin, cookie: cookieHeader(loginCookie) },
      })
      expect(res.status).toBe(201)
      const c = sessionCookies(res)[0]
      expect(c.name).toBe(loginCookie.name)
      expect(c.attrs['domain']).toBe(loginCookie.attrs['domain'])
      expect(c.attrs['path']).toBe(loginCookie.attrs['path'])
      expect(isExpiring(c)).toBe(true)
    })

    it('[rule-foundation-logout][rule-foundation-session-persists] after logout, once the browser has dropped the expired cookie, current-user answers {}', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD)
      const before: any = await (
        await call('/auth/current-user', { headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(cookie) } })
      ).json()
      expect(before.user?.email).toBe('a@example.com')

      const out = await call('/auth/logout', {
        method: 'POST',
        headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(cookie) },
      })
      // A browser deletes a cookie when it receives an expired Set-Cookie with the same name/domain/path.
      const expired = sessionCookies(out).find(
        (c) => c.name === cookie.name && c.attrs['domain'] === cookie.attrs['domain'] && c.attrs['path'] === cookie.attrs['path'],
      )
      expect(expired && isExpiring(expired)).toBe(true)

      const after = await call('/auth/current-user', { headers: { origin: STUDIO_ORIGIN } })
      expect(after.status).toBe(200)
      expect(await after.json()).toEqual({})
    })

    it('[rule-foundation-logout] without cookie and without Origin it succeeds (201) and sets no session cookie', async () => {
      const res = await call('/auth/logout', { method: 'POST' })
      expect(res.status).toBe(201)
      expect(sessionCookies(res)).toHaveLength(0)
    })

    it('[rule-foundation-logout] without session but with an Origin it still succeeds (201, idempotent)', async () => {
      const res = await call('/auth/logout', { method: 'POST', headers: { origin: STUDIO_ORIGIN } })
      expect(res.status).toBe(201)
    })

    it('[rule-foundation-logout] logging out twice in a row succeeds (201) both times', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD)
      const headers = { origin: STUDIO_ORIGIN, cookie: cookieHeader(cookie) }
      expect((await call('/auth/logout', { method: 'POST', headers })).status).toBe(201)
      expect((await call('/auth/logout', { method: 'POST', headers })).status).toBe(201)
    })

    it('[rule-foundation-logout] a user, an administrator and an anonymous caller can all log out (no 401, no 403)', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
      const userToken = await login('a@example.com', PASSWORD)
      const adminToken = await login('boss@example.com', PASSWORD)
      for (const headers of [{}, { authorization: `Bearer ${userToken}` }, { authorization: `Bearer ${adminToken}` }]) {
        const res = await call('/auth/logout', { method: 'POST', headers })
        expect(res.status).toBe(201)
      }
    })

    it('[rule-foundation-logout] logging out does not delete the account: the user can log in again', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { cookie } = await browserLogin('a@example.com', PASSWORD)
      await call('/auth/logout', {
        method: 'POST',
        headers: { origin: STUDIO_ORIGIN, cookie: cookieHeader(cookie) },
      })
      expect(await sql('SELECT 1 FROM base.users')).toHaveLength(1)
      const again = await browserLogin('a@example.com', PASSWORD)
      expect(again.res.status).toBeLessThan(300)
      expect(again.cookie.name).toBe('recouvrement-jwt-localhost')
    })
  })

  describe('POST /auth/login errors (single error message in the studio)', () => {
    it('[rule-foundation-login-single-error] an unknown e-mail and a wrong password give the identical response', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const unknown = await call('/auth/login', {
        method: 'POST',
        headers: { origin: STUDIO_ORIGIN },
        body: { email: 'nobody@example.com', password: PASSWORD, returnToken: false },
      })
      const wrong = await call('/auth/login', {
        method: 'POST',
        headers: { origin: STUDIO_ORIGIN },
        body: { email: 'a@example.com', password: 'wrong-password', returnToken: false },
      })
      expect(unknown.status).toBe(401)
      expect(wrong.status).toBe(401)
      const bodyUnknown = await unknown.json()
      const bodyWrong = await wrong.json()
      expect(JSON.stringify(bodyUnknown)).toContain('security.invalid_credentials')
      expect(bodyUnknown).toEqual(bodyWrong)
      expect(sessionCookies(unknown)).toHaveLength(0)
      expect(sessionCookies(wrong)).toHaveLength(0)
    })

    it('[rule-foundation-login-single-error] the error does not reveal whether the e-mail exists (different case of the password check)', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await expectError(
        client().POST('/auth/login', { body: { email: 'a@example.com', password: PASSWORD.toUpperCase(), returnToken: false } }),
        401,
        'security.invalid_credentials',
      )
      await expectError(
        client().POST('/auth/login', { body: { email: 'b@example.com', password: PASSWORD.toUpperCase(), returnToken: false } }),
        401,
        'security.invalid_credentials',
      )
    })

    it('[rule-foundation-login-single-error] a malformed e-mail answers 400', async () => {
      await expectError(
        client().POST('/auth/login', { body: { email: 'not-an-email', password: PASSWORD, returnToken: false } }),
        400,
      )
    })

    it('[rule-foundation-login-single-error] an empty e-mail answers 400', async () => {
      await expectError(
        client().POST('/auth/login', { body: { email: '', password: PASSWORD, returnToken: false } }),
        400,
      )
    })

    it('[rule-foundation-login-single-error] a failed login sets no session cookie and leaves current-user anonymous', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const res = await call('/auth/login', {
        method: 'POST',
        headers: { origin: STUDIO_ORIGIN },
        body: { email: 'a@example.com', password: 'wrong-password', returnToken: false },
      })
      expect(res.status).toBe(401)
      expect(sessionCookies(res)).toHaveLength(0)
      const me: any = await (await call('/auth/current-user', { headers: { origin: STUDIO_ORIGIN } })).json()
      expect(me.user).toBeUndefined()
    })
  })

  describe('no self-service signup, no password reset', () => {
    it('[rule-foundation-no-self-signup] an anonymous caller cannot create an account through POST /users', async () => {
      const res = await call('/users', {
        method: 'POST',
        body: { email: 'new@example.com', password: PASSWORD, role: 'user' },
      })
      expect(res.status).toBe(401)
      expect(await sql('SELECT 1 FROM base.users')).toHaveLength(0)
    })

    it('[rule-foundation-no-self-signup] a simple user cannot create an account through POST /users', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const token = await login('a@example.com', PASSWORD)
      const res = await call('/users', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: { email: 'new@example.com', password: PASSWORD, role: 'user' },
      })
      expect(res.status).toBe(403)
      expect(await sql('SELECT 1 FROM base.users')).toHaveLength(1)
    })

    it('[rule-foundation-no-self-signup] no public registration route exists and none creates an account', async () => {
      for (const path of ['/auth/register', '/auth/signup', '/auth/sign-up', '/register', '/signup']) {
        const res = await call(path, {
          method: 'POST',
          body: { email: 'new@example.com', password: PASSWORD },
        })
        expect(res.status).toBeGreaterThanOrEqual(400)
      }
      expect(await sql('SELECT 1 FROM base.users')).toHaveLength(0)
    })

    it('[rule-foundation-no-password-reset] no password reset route exists', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      for (const path of [
        '/auth/forgot-password',
        '/auth/reset-password',
        '/auth/password-reset',
        '/auth/request-password-reset',
      ]) {
        const res = await call(path, { method: 'POST', body: { email: 'a@example.com' } })
        expect(res.status).toBeGreaterThanOrEqual(400)
      }
      // the original password still works: nothing was reset
      const token = await login('a@example.com', PASSWORD)
      expect(typeof token).toBe('string')
    })
  })
})
