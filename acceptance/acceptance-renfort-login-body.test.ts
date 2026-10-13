import { sql, resetData, createUser, login, closePool } from './harness'
import { raw, postJson } from './renfort-helpers'

const PASSWORD = 'Passw0rd!x'
const ORIGIN = 'http://localhost:4200'
const MIB = 1024 * 1024

const loginBody = (email: string, password: string, returnToken = true) =>
  JSON.stringify({ email, password, returnToken })

const setCookies = (r: { headers: Record<string, string | string[] | undefined> }) => {
  const v = r.headers['set-cookie']
  return Array.isArray(v) ? v : v ? [v] : []
}

/** JSON valide dont la taille exacte en octets est `size` (le champ `padding` est rempli d'ASCII). */
function jsonOfSize(size: number, base: Record<string, unknown>): string {
  const empty = JSON.stringify({ ...base, padding: '' })
  return JSON.stringify({ ...base, padding: 'a'.repeat(size - Buffer.byteLength(empty)) })
}

const counts = async () => ({
  users: (await sql('select 1 from base.users')).length,
  credentials: (await sql('select 1 from base.credentials')).length,
  audit: (await sql('select 1 from base.audit_logs')).length,
})

// Version `socle-renfort-recette`, points 1 et 2 : empreinte illisible, corps de requête refusés.
describe('Socle renfort - empreinte illisible et corps refusés', () => {
  beforeEach(async () => {
    await resetData()
  })
  afterAll(async () => {
    await closePool()
  })

  describe('POST /auth/login avec une empreinte de mot de passe illisible', () => {
    const badHashes: Array<[string, (valid: string) => string]> = [
      ['vide', () => ''],
      ['texte quelconque', () => 'pas-une-empreinte'],
      ['trop courte', () => '$2b$10$tropcourt'],
      ['empreinte valide altérée', (valid) => valid.slice(0, 20) + '!!!!!!!!!!' + valid.slice(30)],
    ]

    it.each(badHashes)(
      '[rule-foundation-login-single-error] an unreadable stored hash (%s) is refused exactly like a wrong password (token mode)',
      async (_label, make) => {
        await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
        await createUser({ email: 'neighbour@example.com', password: PASSWORD, role: 'user' })
        const [{ password: valid }] = await sql('select password from base.credentials c join base.users u on u.id = c.user_id where u.email = $1', ['a@example.com'])
        await sql('update base.credentials set password = $1 where user_id = (select id from base.users where email = $2)', [make(valid), 'a@example.com'])

        const wrong = await postJson('/auth/login', loginBody('neighbour@example.com', 'wrong-password'))
        const res = await postJson('/auth/login', loginBody('a@example.com', PASSWORD))

        expect(wrong.status).toBe(401)
        expect(res.status).toBe(401)
        expect(res.json.code).toBe('security.invalid_credentials')
        expect(res.json.token).toBeUndefined()
        expect(setCookies(res)).toHaveLength(0)
        expect(res.text).toBe(wrong.text)
        expect(Object.keys(res.json).sort()).toEqual(['code', 'message', 'status'])
      },
    )

    it.each(badHashes)(
      '[rule-foundation-login-single-error] an unreadable stored hash (%s) sets no cookie in browser mode and current-user stays anonymous',
      async (_label, make) => {
        await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
        const [{ password: valid }] = await sql('select password from base.credentials')
        await sql('update base.credentials set password = $1', [make(valid)])

        const res = await postJson('/auth/login', loginBody('a@example.com', PASSWORD, false), { origin: ORIGIN })
        expect(res.status).toBe(401)
        expect(res.json.code).toBe('security.invalid_credentials')
        expect(setCookies(res)).toHaveLength(0)
        expect(res.json.token).toBeUndefined()

        const me = await raw('/auth/current-user', { headers: { origin: ORIGIN } })
        expect(me.status).toBe(200)
        expect(me.json).toEqual({})
      },
    )

    it('[rule-foundation-login-single-error] witness: a neighbouring account with a valid hash still logs in', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await createUser({ email: 'neighbour@example.com', password: PASSWORD, role: 'user' })
      await sql("update base.credentials set password = 'pas-une-empreinte' where user_id = (select id from base.users where email = 'a@example.com')")
      const token = await login('neighbour@example.com', PASSWORD)
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(10)
    })
  })

  describe('corps de requête refusés (Q-PLAT-04, Q-PLAT-01)', () => {
    const forbiddenInBody = (text: string) => {
      for (const needle of ['/home', 'node_modules', '.ts', ' at ', 'stack', 'SyntaxError']) expect(text).not.toContain(needle)
    }

    async function adminToken() {
      await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
      return login('boss@example.com', PASSWORD)
    }

    it('[rule-foundation-login-single-error][Q-PLAT-04] a JSON body of 1 MiB + 1 byte on the public POST /auth/login answers 413 api.payload_too_large', async () => {
      const res = await postJson('/auth/login', jsonOfSize(MIB + 1, { email: 'a@example.com', password: PASSWORD, returnToken: true }))
      expect(res.status).toBe(413)
      expect(res.json.code).toBe('api.payload_too_large')
      expect(Object.keys(res.json).sort()).toEqual(['code', 'message', 'status'])
      expect(res.json.status).toBe(413)
      forbiddenInBody(res.text)
    })

    it('[rule-foundation-user-create-fields][Q-PLAT-04] a JSON body of 1 MiB + 1 byte on POST /users (admin) answers 413 and writes nothing', async () => {
      const token = await adminToken()
      const before = await counts()
      const res = await postJson(
        '/users',
        jsonOfSize(MIB + 1, { email: 'new@example.com', password: PASSWORD, role: 'user' }),
        { authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(413)
      expect(res.json.code).toBe('api.payload_too_large')
      expect(Object.keys(res.json).sort()).toEqual(['code', 'message', 'status'])
      forbiddenInBody(res.text)
      expect(await counts()).toEqual(before)
      expect(await sql("select 1 from base.users where email = 'new@example.com'")).toHaveLength(0)
    })

    it('[Q-PLAT-04] just under the limit there is no 413 (the validation answers 400 instead)', async () => {
      const res = await postJson('/auth/login', jsonOfSize(MIB - 64, { email: 'a@example.com', password: PASSWORD, returnToken: true }))
      expect(res.status).not.toBe(413)
      expect([200, 400, 401]).toContain(res.status)
    })

    it('[Q-PLAT-04] a 413 does not lock the server: a normal request works right after', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await postJson('/auth/login', jsonOfSize(MIB + 1, { email: 'a@example.com', password: PASSWORD, returnToken: true }))
      const token = await login('a@example.com', PASSWORD)
      expect(token.length).toBeGreaterThan(10)
    })

    const malformed: Array<[string, string]> = [
      ['truncated object', '{"email":'],
      ['trailing comma', '{"email":"a@example.com","password":"x",}'],
      ['text that is not JSON', 'ceci n est pas du JSON'],
    ]

    it.each(malformed)('[Q-PLAT-04][Q-PLAT-01] malformed JSON (%s) on POST /auth/login answers 400 api.validation.incoming_failed', async (_l, body) => {
      const res = await postJson('/auth/login', body)
      expect(res.status).toBe(400)
      expect(res.json.code).toBe('api.validation.incoming_failed')
      expect(Object.keys(res.json).sort()).toEqual(['code', 'details', 'message', 'status'])
      expect(res.json.status).toBe(400)
      forbiddenInBody(res.text)
    })

    it.each(malformed)('[rule-foundation-user-create-fields][Q-PLAT-04] malformed JSON (%s) on POST /users (admin) answers 400 and writes nothing', async (_l, body) => {
      const token = await adminToken()
      const before = await counts()
      const res = await postJson('/users', body, { authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
      expect(res.json.code).toBe('api.validation.incoming_failed')
      expect(Object.keys(res.json).sort()).toEqual(['code', 'details', 'message', 'status'])
      forbiddenInBody(res.text)
      expect(await counts()).toEqual(before)
    })

    it('[rule-foundation-no-self-signup][Q-PLAT-04] a rejected body on POST /users without authentication stays 401 and writes nothing', async () => {
      const res = await postJson('/users', '{"email":')
      expect(res.status).toBe(401)
      expect(await counts()).toEqual({ users: 0, credentials: 0, audit: 0 })
    })

    it('[rule-foundation-no-self-signup][Q-PLAT-04] a simple user sending an oversized body on POST /users gets no account created', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const token = await login('a@example.com', PASSWORD)
      const res = await postJson('/users', jsonOfSize(MIB + 1, { email: 'new@example.com', password: PASSWORD, role: 'user' }), {
        authorization: `Bearer ${token}`,
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await sql("select 1 from base.users where email = 'new@example.com'")).toHaveLength(0)
    })
  })
})
