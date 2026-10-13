import jwt from 'jsonwebtoken'
import { getConfig } from '../../../platform/config/config'
import {
  PASSWORD,
  call,
  client,
  closePool,
  cookiePair,
  createUser,
  login,
  resetData,
  setCookies,
  sql,
} from '../../../platform/testing/helpers'

const ORIGIN = 'http://localhost:5173'
const COOKIE = 'recouvrement-jwt-localhost'

const browserLogin = (email: string, password = PASSWORD, origin = ORIGIN) =>
  call('/auth/login', { method: 'POST', headers: { origin }, body: { email, password, returnToken: false } })

describe('auth routes', () => {
  beforeEach(resetData)
  afterAll(closePool)

  describe('POST /auth/login', () => {
    it('[rule-auth-login-email-password] token mode returns a token that identifies the account', async () => {
      const alice = await createUser({ email: 'alice@example.com' })
      const boss = await createUser({ email: 'boss@example.com', role: 'admin' })
      const aliceToken = await login('alice@example.com')
      const bossToken = await login('boss@example.com')
      expect(aliceToken).not.toBe(bossToken)
      expect((await client(aliceToken).GET('/auth/current-user')).data).toEqual({
        user: { id: alice.id, email: 'alice@example.com', role: 'user' },
      })
      expect((await client(bossToken).GET('/auth/current-user')).data).toEqual({
        user: { id: boss.id, email: 'boss@example.com', role: 'admin' },
      })
    })

    it('[rule-auth-login-email-password] answers 200 with the token only', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await call('/auth/login', {
        method: 'POST',
        body: { email: 'alice@example.com', password: PASSWORD, returnToken: true },
      })
      expect(res.status).toBe(200)
      expect(Object.keys(await res.json())).toEqual(['token'])
    })

    it('[rule-auth-login-email-password] the e-mail is compared exactly, case included', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await call('/auth/login', {
        method: 'POST',
        body: { email: 'Alice@example.com', password: PASSWORD, returnToken: true },
      })
      expect(res.status).toBe(401)
    })

    it('[rule-foundation-login-single-error][EXI-PLAT-02] unknown e-mail and wrong password give the same bytes', async () => {
      await createUser({ email: 'alice@example.com' })
      const wrong = await call('/auth/login', {
        method: 'POST',
        body: { email: 'alice@example.com', password: 'nope', returnToken: true },
      })
      const unknown = await call('/auth/login', {
        method: 'POST',
        body: { email: 'nobody@example.com', password: 'nope', returnToken: true },
      })
      expect(wrong.status).toBe(401)
      expect(await wrong.text()).toBe(await unknown.text())
      const body = await (
        await call('/auth/login', {
          method: 'POST',
          body: { email: 'nobody@example.com', password: 'nope', returnToken: true },
        })
      ).json()
      expect(Object.keys(body).sort()).toEqual(['code', 'message', 'status'])
      expect(body).toMatchObject({ status: 401, code: 'security.invalid_credentials' })
    })

    it('[rule-foundation-login-single-error] a wrong password without Origin is still a 401, not an origin error', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await call('/auth/login', {
        method: 'POST',
        body: { email: 'alice@example.com', password: 'nope', returnToken: false },
      })
      expect(res.status).toBe(401)
    })

    it.each([['not-an-email'], [''], ['a@b'], ['a b@example.com'], ['a@@example.com'], ['a@.example.com'], ['a@example.com.']])(
      '[rule-foundation-login-single-error][Q-COMPTES-02] the e-mail %p answers 400 with details',
      async (email) => {
        const res = await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD, returnToken: true } })
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body).toMatchObject({ status: 400, code: 'api.validation.incoming_failed' })
        expect(body.details[0]).toEqual({ path: 'body.email', message: expect.any(String) })
      },
    )

    it('[EXI-PLAT-07] missing or mistyped fields answer 400', async () => {
      for (const body of [{}, { email: 'a@example.com' }, { email: 'a@example.com', password: 1 }, 'text', null]) {
        const res = await call('/auth/login', { method: 'POST', body })
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('api.validation.incoming_failed')
      }
      const typed = await call('/auth/login', {
        method: 'POST',
        body: { email: 'a@example.com', password: PASSWORD, returnToken: 'yes' },
      })
      expect(typed.status).toBe(400)
    })

    it('[EXI-PLAT-06] a null character in a value answers 400', async () => {
      const res = await call('/auth/login', {
        method: 'POST',
        body: { email: 'a@example.com', password: 'pass\u0000word', returnToken: true },
      })
      expect(res.status).toBe(400)
    })

    it('[Q-PLAT-04] malformed JSON answers 400 and a body over 1 MiB answers 413 api.payload_too_large', async () => {
      const malformed = await call('/auth/login', { method: 'POST', rawBody: '{"email":' })
      expect(malformed.status).toBe(400)
      expect((await malformed.json()).code).toBe('api.validation.incoming_failed')
      const huge = await call('/auth/login', {
        method: 'POST',
        body: { email: 'a@example.com', password: 'x'.repeat(2 * 1024 * 1024) },
      })
      expect(huge.status).toBe(413)
      expect(await huge.json()).toMatchObject({ status: 413, code: 'api.payload_too_large' })
    })

    it('[Q-PLAT-07] unknown keys are stripped in silence', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await call('/auth/login', {
        method: 'POST',
        body: { email: 'alice@example.com', password: PASSWORD, returnToken: true, role: 'admin' },
      })
      expect(res.status).toBe(200)
    })

    it('[Q-AUTH-01] valid credentials without Origin and without returnToken answer 400 security.invalid_origin', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await call('/auth/login', {
        method: 'POST',
        body: { email: 'alice@example.com', password: PASSWORD },
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ status: 400, code: 'security.invalid_origin' })
      expect(setCookies(res)).toHaveLength(0)
    })

    it('[Q-AUTH-05][rule-foundation-session-persists] cookie mode answers {} and sets the session cookie of the Origin host', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await browserLogin('alice@example.com')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({})
      const lines = setCookies(res)
      expect(lines).toHaveLength(1)
      const line = lines[0]
      expect(line.startsWith(`${COOKIE}=`)).toBe(true)
      expect(line).toMatch(/HttpOnly/i)
      expect(line).toMatch(/SameSite=Strict/i)
      expect(line).toMatch(/Domain=localhost/i)
      expect(line).toMatch(/Path=\//i)
      expect(line).toMatch(/Max-Age=86400/i)
      expect(line).not.toMatch(/Secure/i)
    })

    it('[Q-AUTH-05] the cookie is Secure outside localhost and follows the host of the Origin', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await browserLogin('alice@example.com', PASSWORD, 'https://app.example.com:8443')
      const line = setCookies(res)[0]
      expect(line.startsWith('recouvrement-jwt-app.example.com=')).toBe(true)
      expect(line).toMatch(/Domain=app\.example\.com/i)
      expect(line).toMatch(/Secure/i)
    })

    it('[rule-foundation-session-persists] token mode sets no cookie', async () => {
      await createUser({ email: 'alice@example.com' })
      const res = await call('/auth/login', {
        method: 'POST',
        headers: { origin: ORIGIN },
        body: { email: 'alice@example.com', password: PASSWORD, returnToken: true },
      })
      expect(setCookies(res)).toHaveLength(0)
    })

    it('[Q-PLAT-01] no error body carries a stack, SQL or file path', async () => {
      const text = await (
        await call('/auth/login', { method: 'POST', body: { email: 'bad', password: 'x', returnToken: true } })
      ).text()
      expect(text).not.toMatch(/\bat \w|\.ts:|\/home\/|select |from "/i)
    })
  })

  describe('GET /auth/current-user', () => {
    it('[rule-auth-session-persistence] answers 200 {} without token', async () => {
      const res = await call('/auth/current-user')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({})
    })

    it('[rule-auth-session-persistence] an invalid bearer token answers 401 security.invalid_token', async () => {
      const res = await call('/auth/current-user', { headers: { authorization: 'Bearer invalid.token.value' } })
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ status: 401, code: 'security.invalid_token' })
    })

    it('[rule-foundation-session-expired] a Authorization header that is not a bearer token is rejected, never ignored', async () => {
      const res = await call('/auth/current-user', { headers: { authorization: 'Basic abc' } })
      expect(res.status).toBe(401)
    })

    it('[rule-foundation-session-expired] several spaces between Bearer and the token are accepted (RFC 6750 §2.1)', async () => {
      await createUser({ email: 'alice@example.com' })
      const token = await login('alice@example.com')
      const res = await call('/auth/current-user', { headers: { authorization: `Bearer   ${token}` } })
      expect(res.status).toBe(200)
      expect((await res.json()).user?.email).toBe('alice@example.com')
    })

    it('[rule-foundation-session-expired] a tab between Bearer and a valid token answers 401 security.invalid_token', async () => {
      await createUser({ email: 'alice@example.com' })
      const token = await login('alice@example.com')
      const res = await call('/auth/current-user', { headers: { authorization: `Bearer\t${token}` } })
      expect(res.status).toBe(401)
      expect((await res.json()).code).toBe('security.invalid_token')
    })

    it('[rule-foundation-session-expired] an expired token answers 401', async () => {
      const user = await createUser({ email: 'alice@example.com' })
      const expired = jwt.sign({ role: 'user' }, getConfig().jwtSecret, {
        algorithm: 'HS256',
        subject: user.id,
        expiresIn: -10,
      })
      const res = await call('/auth/current-user', { headers: { authorization: `Bearer ${expired}` } })
      expect(res.status).toBe(401)
      expect((await res.json()).code).toBe('security.invalid_token')
    })

    it('[rule-foundation-session-expired] a token signed with another secret answers 401', async () => {
      const user = await createUser({ email: 'alice@example.com' })
      const forged = jwt.sign({ role: 'admin' }, 'another-secret-entirely', { subject: user.id, expiresIn: 60 })
      const res = await call('/auth/current-user', { headers: { authorization: `Bearer ${forged}` } })
      expect(res.status).toBe(401)
    })

    it('[rule-foundation-session-expired] a valid token of an account that no longer exists answers 401 security.invalid_token', async () => {
      await createUser({ email: 'alice@example.com' })
      const token = await login('alice@example.com')
      await sql('delete from base.users')
      const res = await call('/auth/current-user', { headers: { authorization: `Bearer ${token}` } })
      expect(res.status).toBe(401)
      expect((await res.json()).code).toBe('security.invalid_token')
    })

    it('[Q-AUTH-04] the role stays the one of the token until the next login', async () => {
      const user = await createUser({ email: 'alice@example.com', role: 'user' })
      const token = await login('alice@example.com')
      await sql("update base.users set role = 'admin' where id = $1", [user.id])
      expect((await client(token).GET('/auth/current-user')).data?.user?.role).toBe('user')
      const fresh = await login('alice@example.com')
      expect((await client(fresh).GET('/auth/current-user')).data?.user?.role).toBe('admin')
    })

    it('[rule-foundation-session-persists] the cookie identifies the account with Origin, or Referer after a reload', async () => {
      const user = await createUser({ email: 'alice@example.com' })
      const pair = cookiePair(setCookies(await browserLogin('alice@example.com'))[0])
      const withOrigin = await call('/auth/current-user', { headers: { origin: ORIGIN, cookie: pair } })
      const withReferer = await call('/auth/current-user', { headers: { referer: `${ORIGIN}/groupes`, cookie: pair } })
      for (const res of [withOrigin, withReferer]) {
        expect((await res.json()).user).toEqual({ id: user.id, email: 'alice@example.com', role: 'user' })
      }
      // neither Origin nor Referer: the cookie name cannot be derived, the cookie is not read
      expect(await (await call('/auth/current-user', { headers: { cookie: pair } })).json()).toEqual({})
    })

    it('[rule-foundation-session-persists] a cookie of another host name is not read', async () => {
      await createUser({ email: 'alice@example.com' })
      const value = cookiePair(setCookies(await browserLogin('alice@example.com'))[0]).split('=')[1]
      const res = await call('/auth/current-user', {
        headers: { origin: 'http://other.example.com', cookie: `${COOKIE}=${value}` },
      })
      expect(await res.json()).toEqual({})
    })

    it('[rule-foundation-session-expired] a cookie holding an invalid token answers 401', async () => {
      const res = await call('/auth/current-user', { headers: { origin: ORIGIN, cookie: `${COOKIE}=garbage` } })
      expect(res.status).toBe(401)
    })

    it('[EXI-PLAT-17] reflects the Origin with credentials, answers a preflight, never uses *', async () => {
      const res = await call('/auth/current-user', { headers: { origin: 'http://localhost:4200' } })
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4200')
      expect(res.headers.get('access-control-allow-credentials')).toBe('true')
      const preflight = await call('/auth/login', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:4200',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:4200')
      expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')
      const anonymous = await call('/auth/current-user')
      expect(anonymous.headers.get('access-control-allow-origin')).toBeNull()
    })
  })

  describe('POST /auth/logout', () => {
    it('[rule-foundation-logout] answers 201 without body, expires the cookie with the login attributes', async () => {
      await createUser({ email: 'alice@example.com' })
      const login = setCookies(await browserLogin('alice@example.com'))[0]
      const res = await call('/auth/logout', { method: 'POST', headers: { origin: ORIGIN, cookie: cookiePair(login) } })
      expect(res.status).toBe(201)
      expect(await res.text()).toBe('')
      const lines = setCookies(res)
      expect(lines).toHaveLength(1)
      expect(lines[0].startsWith(`${COOKIE}=;`)).toBe(true)
      expect(lines[0]).toMatch(/Expires=Thu, 01 Jan 1970/i)
      for (const attribute of [/Domain=localhost/i, /Path=\//i, /HttpOnly/i, /SameSite=Strict/i]) {
        expect(lines[0]).toMatch(attribute)
      }
    })

    it('[rule-foundation-logout] the expiring cookie of an https host is Secure like the login cookie', async () => {
      await createUser({ email: 'alice@example.com' })
      const origin = 'https://app.example.com:3000'
      const login = setCookies(await browserLogin('alice@example.com', PASSWORD, origin))[0]
      const out = setCookies(await call('/auth/logout', { method: 'POST', headers: { origin } }))[0]
      expect(out.startsWith('recouvrement-jwt-app.example.com=;')).toBe(true)
      expect(/Secure/i.test(out)).toBe(/Secure/i.test(login))
    })

    it('[rule-foundation-logout] is idempotent and public: no cookie without Origin, never 401 or 403, even with a bad token', async () => {
      const bare = await call('/auth/logout', { method: 'POST' })
      expect(bare.status).toBe(201)
      expect(setCookies(bare)).toHaveLength(0)
      for (let i = 0; i < 2; i++) {
        const res = await call('/auth/logout', {
          method: 'POST',
          headers: { origin: ORIGIN, authorization: 'Bearer not-a-token' },
        })
        expect(res.status).toBe(201)
      }
    })
  })

  describe('platform', () => {
    it('[Q-PLAT-06] an unknown path answers 404 api.route_not_found for anybody', async () => {
      await createUser({ email: 'alice@example.com' })
      const token = await login('alice@example.com')
      const callers: Record<string, string>[] = [{}, { authorization: `Bearer ${token}` }]
      for (const headers of callers) {
        const res = await call('/nothing/here', { headers })
        expect(res.status).toBe(404)
        expect(await res.json()).toMatchObject({ status: 404, code: 'api.route_not_found' })
        expect(res.headers.get('x-request-id')).toBeTruthy()
      }
    })

    it('[rule-foundation-no-self-signup][rule-foundation-no-password-reset] no registration or reset route exists', async () => {
      for (const path of ['/auth/register', '/auth/signup', '/auth/forgot-password', '/auth/reset-password']) {
        const res = await call(path, { method: 'POST', body: { email: 'a@example.com' } })
        expect(res.status).toBe(404)
      }
      expect(await sql('select 1 from base.users')).toHaveLength(0)
    })

    it('[Q-PLAT-03] the OpenAPI document is served in test, with both security schemes and no test route', async () => {
      const res = await call('/api-json')
      expect(res.status).toBe(200)
      const doc = await res.json()
      expect(Object.keys(doc.paths).sort()).toEqual([
        '/audit-logs',
        '/audit-logs/filters',
        '/auth/current-user',
        '/auth/login',
        '/auth/logout',
        '/groups',
        '/groups/{id}',
        '/scopes',
        '/scopes/{id}',
        '/server/health-check',
        '/users',
        '/users/imports/preview',
        '/users/imports/specification',
        '/users/imports/{importId}/confirm',
        '/users/imports/{importId}/errors',
        '/users/{id}',
      ])
      expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(['bearer', 'cookie'])
      expect(JSON.stringify(doc)).not.toMatch(/\/test\/|company|tenant|entreprise/i)
      expect((await call('/api')).status).toBe(200)
    })

    it('[EXI-PLAT-04][EXI-PLAT-09] the {} answers of login and current-user conform to their schemas (contract-changes.yaml)', async () => {
      const doc = await (await call('/api-json')).json()
      // `user` and `token` are optional: a visitor / the cookie mode really answer `{}`
      expect(doc.components.schemas.CurrentUserResponseDTO.required).toBeUndefined()
      expect(doc.components.schemas.LoginWithPasswordResponseDto.required).toBeUndefined()
      expect(doc.components.schemas.LoginWithPasswordParamsDto.required).toEqual(['email', 'password'])
    })
  })
})
