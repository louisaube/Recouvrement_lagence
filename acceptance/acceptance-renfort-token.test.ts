import { resetData, createUser, login, closePool } from './harness'
import { raw, decodePayload, forgeHmac, forgeNone } from './renfort-helpers'

const PASSWORD = 'Passw0rd!x'
const ORIGIN = 'http://localhost:4200'
const COOKIE = 'monappli-jwt-localhost'

const asHeader = (token: string) => ({ authorization: `Bearer ${token}` })
const withCookie = (cookie: string) => ({ origin: ORIGIN, cookie })

// Version `socle-renfort-recette`, points 4 et 5 : lecture stricte de l'en-tête et du cookie, algorithme du jeton.
describe('Socle renfort - lecture stricte du jeton', () => {
  let token: string
  let admin: { id: string; email: string }

  beforeEach(async () => {
    await resetData()
    admin = await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
    token = await login('boss@example.com', PASSWORD)
  })
  afterAll(async () => {
    await closePool()
  })

  describe('en-tête Authorization', () => {
    const malformed: Array<[string, (t: string) => string]> = [
      ['Bearer <jeton> extra', (t) => `Bearer ${t} extra`],
      ['Bearer <jeton> <jeton>', (t) => `Bearer ${t} ${t}`],
      ['Basic <jeton>', (t) => `Basic ${t}`],
      ['Token <jeton>', (t) => `Token ${t}`],
      ['<jeton> seul', (t) => t],
      ['Bearer seul', () => 'Bearer'],
      // Version `socle-bearer-rfc6750` : « Bearer + deux espaces + <jeton> » est désormais accepté (RFC 6750 §2.1),
      // voir acceptance-bearer-rfc6750.test.ts ; la tabulation reste refusée.
      ['Bearer + tabulation + <jeton>', (t) => `Bearer\t${t}`],
    ]
    // Espaces avant ou après la valeur : non vérifiables. Le parseur HTTP (RFC 9110 §5.5) retire ces espaces
    // avant tout code applicatif, le serveur reçoit donc `Bearer <jeton>` à l'identique (contestation acceptée).

    it.each(malformed)(
      '[rule-foundation-session-expired] Authorization « %s » answers 401 security.invalid_token on GET /auth/current-user even though the token is valid',
      async (_l, make) => {
        const res = await raw('/auth/current-user', { headers: { authorization: make(token) } })
        expect(res.status).toBe(401)
        expect(res.json.code).toBe('security.invalid_token')
        expect(res.json.user).toBeUndefined()
      },
    )

    it.each(malformed)(
      '[rule-foundation-session-expired] Authorization « %s » answers 401 security.invalid_token on a protected route (GET /users, admin)',
      async (_l, make) => {
        const res = await raw('/users', { headers: { authorization: make(token) } })
        expect(res.status).toBe(401)
        expect(res.json.code).toBe('security.invalid_token')
      },
    )

    it('[rule-foundation-session-expired] a malformed Authorization is not rescued by a valid session cookie', async () => {
      const res = await raw('/auth/current-user', {
        headers: { ...withCookie(`${COOKIE}=${token}`), authorization: `Bearer ${token} extra` },
      })
      expect(res.status).toBe(401)
      expect(res.json.code).toBe('security.invalid_token')
    })

    it('[rule-foundation-session-expired] witness: exactly « Bearer <jeton> » is accepted on both routes', async () => {
      const me = await raw('/auth/current-user', { headers: asHeader(token) })
      expect(me.status).toBe(200)
      expect(me.json.user).toMatchObject({ id: admin.id, email: 'boss@example.com', role: 'admin' })
      const list = await raw('/users', { headers: asHeader(token) })
      expect(list.status).toBe(200)
    })
  })

  describe('cookie de session renvoyé par le client', () => {
    it('[rule-foundation-session-persists] the cookie alone authenticates GET /auth/current-user', async () => {
      const res = await raw('/auth/current-user', { headers: withCookie(`${COOKIE}=${token}`) })
      expect(res.status).toBe(200)
      expect(res.json.user).toMatchObject({ id: admin.id, email: 'boss@example.com', role: 'admin' })
    })

    const forms: Array<[string, (t: string) => string]> = [
      ['among other cookies', (t) => `a=b; ${COOKIE}=${t}; c=d`],
      ['first of several cookies', (t) => `${COOKIE}=${t}; a=b; c=d`],
      ['last of several cookies', (t) => `a=b; c=d; ${COOKIE}=${t}`],
      ['without space after the semicolon', (t) => `a=b;${COOKIE}=${t};c=d`],
      ['with several spaces after the semicolon', (t) => `a=b;   ${COOKIE}=${t};   c=d`],
      ['with a leading space', (t) => ` ${COOKIE}=${t}`],
    ]

    it.each(forms)('[rule-foundation-session-persists] the session cookie %s authenticates the caller', async (_l, make) => {
      const res = await raw('/auth/current-user', { headers: withCookie(make(token)) })
      expect(res.status).toBe(200)
      expect(res.json.user).toMatchObject({ id: admin.id, role: 'admin' })
    })

    it('[rule-foundation-session-persists] the cookie issued at browser login, sent back as is, authenticates the caller', async () => {
      const loginRes = await raw('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'boss@example.com', password: PASSWORD, returnToken: false }),
      })
      const lines = ([] as string[]).concat((loginRes.headers['set-cookie'] as string[]) ?? [])
      const pair = lines[0].split(';')[0]
      expect(pair.startsWith(`${COOKIE}=`)).toBe(true)
      const res = await raw('/auth/current-user', { headers: withCookie(`theme=dark; ${pair}`) })
      expect(res.json.user).toMatchObject({ id: admin.id })
    })

    const notSession: Array<[string, (t: string) => string]> = [
      ['another prefix', (t) => `other-jwt-localhost=${t}`],
      ['another host in the name', (t) => `monappli-jwt-example.com=${t}`],
      ['a name that only contains the right one', (t) => `x${COOKIE}=${t}`],
      ['a longer name starting with the right one', (t) => `${COOKIE}2=${t}`],
      ['a plain name', (t) => `session=${t}`],
      ['the right name without value', () => `${COOKIE}=`],
      ['the right name with a blank value', () => `${COOKIE}=   `],
    ]

    it.each(notSession)(
      '[rule-foundation-session-persists] a cookie with %s does not authenticate the caller (200 {})',
      async (_l, make) => {
        const res = await raw('/auth/current-user', { headers: withCookie(make(token)) })
        expect(res.status).toBe(200)
        expect(res.json).toEqual({})
      },
    )

    it('[rule-foundation-session-persists] a cookie of the right name sent with an Origin of another host is not used', async () => {
      const res = await raw('/auth/current-user', {
        headers: { origin: 'http://app.example.com:3000', cookie: `${COOKIE}=${token}` },
      })
      expect(res.status).toBe(200)
      expect(res.json).toEqual({})
    })

    it('[rule-foundation-session-expired] a cookie of the right name holding an invalid token answers 401 security.invalid_token', async () => {
      const res = await raw('/auth/current-user', { headers: withCookie(`a=b; ${COOKIE}=not.a.token`) })
      expect(res.status).toBe(401)
      expect(res.json.code).toBe('security.invalid_token')
    })
  })

  describe('algorithme du jeton', () => {
    const claims = () => decodePayload(token)

    it('[rule-foundation-session-expired] witness: the claims re-signed in HS256 with the server secret are accepted (the forged tokens below differ only by the algorithm)', async () => {
      const forged = forgeHmac('HS256', claims())
      const res = await raw('/auth/current-user', { headers: asHeader(forged) })
      expect(res.status).toBe(200)
      expect(res.json.user).toMatchObject({ id: admin.id, role: 'admin' })
    })

    const algs: Array<[string, () => string]> = [
      ['HS512 with the same secret', () => forgeHmac('HS512', claims())],
      ['HS384 with the same secret', () => forgeHmac('HS384', claims())],
      ['alg none with a trailing dot', () => forgeNone(claims(), true)],
      ['alg none without trailing dot', () => forgeNone(claims(), false)],
    ]

    it.each(algs)('[rule-foundation-session-expired] a token signed with %s is refused in the Authorization header (401 security.invalid_token)', async (_l, make) => {
      const forged = make()
      const me = await raw('/auth/current-user', { headers: asHeader(forged) })
      expect(me.status).toBe(401)
      expect(me.json.code).toBe('security.invalid_token')
      expect(me.json.user).toBeUndefined()
      const list = await raw('/users', { headers: asHeader(forged) })
      expect(list.status).toBe(401)
      expect(list.json.code).toBe('security.invalid_token')
    })

    it.each(algs)('[rule-foundation-session-expired] a token signed with %s is refused in the session cookie (401 security.invalid_token)', async (_l, make) => {
      const res = await raw('/auth/current-user', { headers: withCookie(`${COOKIE}=${make()}`) })
      expect(res.status).toBe(401)
      expect(res.json.code).toBe('security.invalid_token')
      expect(res.json.user).toBeUndefined()
    })
  })
})
