import { resetData, closePool } from './harness'
import { userWithToken } from './scope-helpers'
import { plain, SPECIFICATION } from './import-helpers'

// Acceptance suite of version socle-import-excel: GET /users/imports/specification.
describe('GET /users/imports/specification', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
  })
  afterAll(async () => {
    await closePool()
  })

  it('[rule-foundation-import-users-columns] [rule-foundation-import-declared-columns] lists email, role (required) and groupes (optional) with French descriptions', async () => {
    const res = await plain('GET', SPECIFICATION, admin.token)
    expect(res.status).toBe(200)
    expect(res.body.columns.map((c: any) => c.name)).toEqual(['email', 'role', 'groupes'])
    expect(res.body.columns.map((c: any) => c.required)).toEqual([true, true, false])
    for (const c of res.body.columns) {
      expect(typeof c.description).toBe('string')
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.description.length).toBeLessThanOrEqual(500)
    }
    const byName = Object.fromEntries(res.body.columns.map((c: any) => [c.name, c.description]))
    expect(byName.email).toContain('254')
    expect(byName.role).toContain('user')
    expect(byName.role).toContain('admin')
    expect(byName.groupes).toContain(';')
  })

  it('[rule-foundation-import-formats] [rule-foundation-import-limits] announces .xlsx and .csv, 100 MiB and 1,000,000 rows', async () => {
    const res = await plain('GET', SPECIFICATION, admin.token)
    expect(res.status).toBe(200)
    expect(res.body.acceptedExtensions).toEqual(['.xlsx', '.csv'])
    expect(res.body.maxFileSizeBytes).toBe(104857600)
    expect(res.body.maxRows).toBe(1000000)
  })

  it('[rule-foundation-import-users-admin-only] an ordinary user gets 403 security.access_denied and no specification', async () => {
    const res = await plain('GET', SPECIFICATION, user.token)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('security.access_denied')
    expect(res.body.columns).toBeUndefined()
  })

  it('[rule-foundation-import-users-admin-only] anonymous and invalid-token calls get 401', async () => {
    expect((await plain('GET', SPECIFICATION)).status).toBe(401)
    expect((await plain('GET', SPECIFICATION, 'not-a-token')).status).toBe(401)
  })

  it('[rule-foundation-import-users-admin-only] the route is not captured by GET /users/:id (no 400 for a malformed id, no user shape)', async () => {
    const res = await plain('GET', SPECIFICATION, admin.token)
    expect(res.status).toBe(200)
    expect(res.body.user).toBeUndefined()
  })
})
