import { api, sql, resetData, createUser, login, closePool, API_URL } from './harness'

const client = (token?: string): any => api(token) as any

const expectError = (p: Promise<unknown>, status: number, code?: string) =>
  expect(p).rejects.toMatchObject({ status, ...(code ? { code } : {}) })

const PASSWORD = 'Passw0rd!x'

// Foundation acceptance suite (frozen): authentication and access control of the foundation.
describe('Authentication', () => {
  beforeEach(async () => {
    await resetData()
  })
  afterAll(async () => {
    await closePool()
  })

  describe('POST /auth/login', () => {
    it('[rule-auth-login-email-password] returns a token for a valid email and password', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const { data } = await client().POST('/auth/login', {
        body: { email: 'a@example.com', password: PASSWORD, returnToken: true },
      })
      expect(typeof data.token).toBe('string')
      expect(data.token.length).toBeGreaterThan(10)
    })

    it('[rule-auth-login-email-password] the token identifies the user through GET /auth/current-user', async () => {
      const u = await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const token = await login('a@example.com', PASSWORD)
      const { data } = await client(token).GET('/auth/current-user')
      expect(data.user).toMatchObject({ id: u.id, email: 'a@example.com', role: 'user' })
    })

    it('[rule-auth-login-email-password] an admin can log in and is identified as admin', async () => {
      await createUser({ email: 'admin@example.com', password: PASSWORD, role: 'admin' })
      const token = await login('admin@example.com', PASSWORD)
      const { data } = await client(token).GET('/auth/current-user')
      expect(data.user.role).toBe('admin')
    })

    it('[rule-auth-login-email-password] each user gets their own identity', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await createUser({ email: 'b@example.com', password: 'Other-Passw0rd!', role: 'user' })
      const ta = await login('a@example.com', PASSWORD)
      const tb = await login('b@example.com', 'Other-Passw0rd!')
      expect((await client(ta).GET('/auth/current-user')).data.user.email).toBe('a@example.com')
      expect((await client(tb).GET('/auth/current-user')).data.user.email).toBe('b@example.com')
    })

    it('[rule-auth-login-error-message] a wrong password answers 401 security.invalid_credentials', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await expectError(
        client().POST('/auth/login', { body: { email: 'a@example.com', password: 'wrong-password', returnToken: true } }),
        401,
        'security.invalid_credentials',
      )
    })

    it('[rule-auth-login-error-message] an unknown email answers 401 security.invalid_credentials (same error as a wrong password)', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await expectError(
        client().POST('/auth/login', { body: { email: 'nobody@example.com', password: PASSWORD, returnToken: true } }),
        401,
        'security.invalid_credentials',
      )
    })

    it('[rule-auth-login-email-password] a password of another user does not log in', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      await createUser({ email: 'b@example.com', password: 'Other-Passw0rd!', role: 'user' })
      await expectError(
        client().POST('/auth/login', { body: { email: 'a@example.com', password: 'Other-Passw0rd!', returnToken: true } }),
        401,
        'security.invalid_credentials',
      )
    })

    it('[rule-auth-login-email-password] a failed login does not create a session or a user', async () => {
      await client()
        .POST('/auth/login', { body: { email: 'ghost@example.com', password: PASSWORD, returnToken: true } })
        .catch(() => undefined)
      expect(await sql('SELECT 1 FROM base.users')).toHaveLength(0)
    })
  })

  describe('GET /auth/current-user', () => {
    it('[rule-auth-session-persistence] returns no user without a token', async () => {
      const { data } = await client().GET('/auth/current-user')
      expect(data?.user).toBeUndefined()
    })

    it('[rule-auth-session-persistence] a stored valid token still identifies the user on a later call', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'user' })
      const token = await login('a@example.com', PASSWORD)
      const first = await client(token).GET('/auth/current-user')
      const second = await client(token).GET('/auth/current-user')
      expect(second.data.user.id).toBe(first.data.user.id)
    })

    it('[rule-auth-session-persistence] an invalid token answers 401 security.invalid_token', async () => {
      await expectError(client('invalid.token.value').GET('/auth/current-user'), 401, 'security.invalid_token')
    })
  })

  describe('foundation access control', () => {
    it('[foundation-auth] an anonymous caller cannot create users through POST /users', async () => {
      const res = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: PASSWORD, role: 'user' }),
      })
      expect(res.status).toBe(401)
      expect(await sql('SELECT 1 FROM base.users')).toHaveLength(0)
    })

    it('[foundation-auth] a token obtained through login is accepted by a protected route', async () => {
      await createUser({ email: 'a@example.com', password: PASSWORD, role: 'admin' })
      const token = await login('a@example.com', PASSWORD)
      const res = await fetch(`${API_URL}/users`, { headers: { authorization: `Bearer ${token}` } })
      expect(res.status).toBe(200)
    })

    it('[foundation-auth] a protected route answers 401 without a token', async () => {
      const res = await fetch(`${API_URL}/users`)
      expect(res.status).toBe(401)
    })
  })
})
