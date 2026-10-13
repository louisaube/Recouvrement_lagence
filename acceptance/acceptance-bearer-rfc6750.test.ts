import { resetData, createUser, login, closePool } from './harness'
import { raw } from './renfort-helpers'

const PASSWORD = 'Passw0rd!x'
const ORIGIN = 'http://localhost:4200'
const COOKIE = 'monappli-jwt-localhost'

// Version `socle-bearer-rfc6750` : RFC 6750 §2.1 - « Bearer », une ou plusieurs espaces (U+0020), le jeton.
describe('Socle - en-tête Authorization selon la RFC 6750', () => {
  let token: string
  let userToken: string
  let admin: { id: string; email: string }

  beforeEach(async () => {
    await resetData()
    admin = await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
    await createUser({ email: 'simple@example.com', password: PASSWORD, role: 'user' })
    token = await login('boss@example.com', PASSWORD)
    userToken = await login('simple@example.com', PASSWORD)
  })
  afterAll(async () => {
    await closePool()
  })

  const accepted: Array<[string, (t: string) => string]> = [
    ['Bearer + 1 espace + <jeton>', (t) => `Bearer ${t}`],
    ['Bearer + 2 espaces + <jeton>', (t) => `Bearer  ${t}`],
    ['Bearer + 3 espaces + <jeton>', (t) => `Bearer   ${t}`],
    ['Bearer + 10 espaces + <jeton>', (t) => `Bearer${' '.repeat(10)}${t}`],
    ['bearer (minuscules) + 3 espaces + <jeton>', (t) => `bearer   ${t}`],
    ['BEARER (majuscules) + 2 espaces + <jeton>', (t) => `BEARER  ${t}`],
  ]

  const refused: Array<[string, (t: string) => string]> = [
    ['Bearer + tabulation + <jeton>', (t) => `Bearer\t${t}`],
    ['Bearer + espace + tabulation + <jeton>', (t) => `Bearer \t${t}`],
    ['Bearer + tabulation + espace + <jeton>', (t) => `Bearer\t ${t}`],
    ['Bearer + 2 espaces + tabulation + <jeton>', (t) => `Bearer  \t${t}`],
    ['Bearer + espace insécable (U+00A0) + <jeton>', (t) => `Bearer ${t}`],
    ['Bearer + espace + espace insécable + <jeton>', (t) => `Bearer  ${t}`],
    ['Bearer + 2 espaces + <jeton> + texte', (t) => `Bearer  ${t} extra`],
    ['Bearer + 1 espace + <jeton> + 2 espaces + texte', (t) => `Bearer ${t}  extra`],
    ['Bearer + 2 espaces + <jeton> + second jeton identique', (t) => `Bearer  ${t}  ${t}`],
    ['Bearer + 1 espace + <jeton> + tabulation + texte', (t) => `Bearer ${t}\textra`],
    ['Bearer + 1 espace + <jeton> + tabulation + jeton', (t) => `Bearer ${t}\t${t}`],
    ['Basic + 2 espaces + <jeton>', (t) => `Basic  ${t}`],
    ['Token + 2 espaces + <jeton>', (t) => `Token  ${t}`],
    ['Bearerx + 2 espaces + <jeton>', (t) => `Bearerx  ${t}`],
    ['Bearer collé au jeton', (t) => `Bearer${t}`],
    ['<jeton> seul', (t) => t],
    ['Bearer seul', () => 'Bearer'],
    ['Bearer + espaces sans jeton', () => 'Bearer    '],
  ]

  describe('formes acceptées', () => {
    it.each(accepted)(
      '[rule-foundation-session-expired] Authorization « %s » is accepted on GET /auth/current-user (200, current user)',
      async (_l, make) => {
        const res = await raw('/auth/current-user', { headers: { authorization: make(token) } })
        expect(res.status).toBe(200)
        expect(res.json.user).toMatchObject({ id: admin.id, email: 'boss@example.com', role: 'admin' })
      },
    )

    it.each(accepted)(
      '[rule-foundation-session-expired] Authorization « %s » is accepted on a protected route (GET /users, admin: 200)',
      async (_l, make) => {
        const res = await raw('/users', { headers: { authorization: make(token) } })
        expect(res.status).toBe(200)
      },
    )

    it('[rule-foundation-session-expired] several spaces identify the caller as the token owner, not as anyone else (simple user)', async () => {
      const res = await raw('/auth/current-user', { headers: { authorization: `Bearer   ${userToken}` } })
      expect(res.status).toBe(200)
      expect(res.json.user).toMatchObject({ email: 'simple@example.com', role: 'user' })
    })
  })

  describe('formes refusées', () => {
    it.each(refused)(
      '[rule-foundation-session-expired] Authorization « %s » answers 401 security.invalid_token on GET /auth/current-user even though the token is valid',
      async (_l, make) => {
        const res = await raw('/auth/current-user', { headers: { authorization: make(token) } })
        expect(res.status).toBe(401)
        expect(res.json.code).toBe('security.invalid_token')
        expect(res.json.user).toBeUndefined()
      },
    )

    it.each(refused)(
      '[rule-foundation-session-expired] Authorization « %s » answers 401 security.invalid_token on a protected route (GET /users, admin)',
      async (_l, make) => {
        const res = await raw('/users', { headers: { authorization: make(token) } })
        expect(res.status).toBe(401)
        expect(res.json.code).toBe('security.invalid_token')
      },
    )

    it('[rule-foundation-session-expired] the 401 body is limited to status, code and message', async () => {
      const res = await raw('/auth/current-user', { headers: { authorization: `Bearer\t${token}` } })
      expect(res.status).toBe(401)
      expect(Object.keys(res.json).sort()).toEqual(['code', 'message', 'status'])
      expect(res.json.status).toBe(401)
    })
  })

  describe('jeton invalide derrière plusieurs espaces', () => {
    it('[rule-foundation-session-expired] an invalid token behind several spaces answers 401 security.invalid_token (never ignored)', async () => {
      for (const path of ['/auth/current-user', '/users']) {
        const res = await raw(path, { headers: { authorization: 'Bearer    not.a.token' } })
        expect(res.status).toBe(401)
        expect(res.json.code).toBe('security.invalid_token')
      }
    })

    it('[rule-foundation-session-expired] a truncated valid token behind several spaces answers 401 security.invalid_token', async () => {
      const res = await raw('/auth/current-user', { headers: { authorization: `Bearer   ${token.slice(0, -4)}` } })
      expect(res.status).toBe(401)
      expect(res.json.code).toBe('security.invalid_token')
    })
  })

  describe('priorité sur le cookie', () => {
    it('[rule-foundation-session-expired] a refused form (tab) is not rescued by a valid session cookie', async () => {
      const res = await raw('/auth/current-user', {
        headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, authorization: `Bearer\t${token}` },
      })
      expect(res.status).toBe(401)
      expect(res.json.code).toBe('security.invalid_token')
    })

    it('[rule-foundation-session-persists] several spaces: the bearer token comes first, the cookie of another account is not used', async () => {
      const res = await raw('/auth/current-user', {
        headers: { origin: ORIGIN, cookie: `${COOKIE}=${userToken}`, authorization: `Bearer   ${token}` },
      })
      expect(res.status).toBe(200)
      expect(res.json.user).toMatchObject({ email: 'boss@example.com', role: 'admin' })
    })

    it('[rule-foundation-session-expired] an invalid token behind several spaces is not rescued by a valid session cookie', async () => {
      const res = await raw('/auth/current-user', {
        headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, authorization: 'Bearer   not.a.token' },
      })
      expect(res.status).toBe(401)
      expect(res.json.code).toBe('security.invalid_token')
    })
  })

  describe('droits inchangés', () => {
    it('[rule-foundation-session-persists] without Authorization header: GET /auth/current-user answers 200 {} and GET /users answers 401', async () => {
      const me = await raw('/auth/current-user')
      expect(me.status).toBe(200)
      expect(me.json).toEqual({})
      const list = await raw('/users')
      expect(list.status).toBe(401)
    })

    it('[rule-foundation-users-list-admin-only] a simple user with several spaces is authenticated but still gets 403 on GET /users', async () => {
      const res = await raw('/users', { headers: { authorization: `Bearer   ${userToken}` } })
      expect(res.status).toBe(403)
    })

    it('[rule-foundation-users-list-admin-only] an admin with several spaces gets 200 on GET /users', async () => {
      const res = await raw('/users', { headers: { authorization: `Bearer    ${token}` } })
      expect(res.status).toBe(200)
    })
  })
})
