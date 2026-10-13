import { sql, resetData, closePool, createUser, login } from './harness'
import {
  call,
  userWithToken,
  seedScope,
  seedGroup,
  groupIdsOfUser,
  UNKNOWN_UUID,
  PASSWORD,
} from './scope-helpers'

// Acceptance suite of version socle-groupes-perimetres: user administration and account privacy.
describe('Users administration', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>
  let other: Awaited<ReturnType<typeof userWithToken>>
  let gA: { id: string; name: string }
  let gB: { id: string; name: string }

  const countUsers = async () => (await sql('select 1 from base.users')).length

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
    other = await userWithToken('other@example.com', 'user')
    const s = await seedScope('s1', 'Site 1')
    gA = await seedGroup('Beta', { scopeIds: [s.id] })
    gB = await seedGroup('alpha', { scopeIds: [s.id] })
  })
  afterAll(async () => {
    await closePool()
  })

  describe('GET /users', () => {
    it('[rule-foundation-users-list-admin-only] an admin lists accounts sorted by e-mail, with their groups sorted by name', async () => {
      await sql('insert into base.group_users (group_id, user_id, created_at) values ($1, $2, now()), ($3, $2, now())', [gA.id, user.id, gB.id])
      const res = await call('GET', '/users', admin.token)
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(3)
      expect(res.body.users.map((u: any) => u.email)).toEqual(['admin@example.com', 'other@example.com', 'user@example.com'])
      const u = res.body.users.find((x: any) => x.email === 'user@example.com')
      expect(Object.keys(u).sort()).toEqual(['email', 'groups', 'id', 'role'])
      expect(u.groups).toEqual([
        { id: gB.id, name: 'alpha' },
        { id: gA.id, name: 'Beta' },
      ])
      expect(res.body.users.find((x: any) => x.email === 'other@example.com').groups).toEqual([])
    })

    it('[rule-foundation-users-list-admin-only] [rule-foundation-list-pagination] pagination from/size with total', async () => {
      const res = await call('GET', '/users?from=1&size=1', admin.token)
      expect(res.status).toBe(200)
      expect(res.body.users.map((u: any) => u.email)).toEqual(['other@example.com'])
      expect(res.body.total).toBe(3)
    })

    it.each(['size=0', 'size=101', 'size=-1', 'size=x', 'from=-1', 'from=x'])(
      '[rule-foundation-list-pagination] query %s answers 400 api.validation.incoming_failed',
      async (query) => {
        const res = await call('GET', `/users?${query}`, admin.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      },
    )

    it('[rule-foundation-list-pagination] size 100 is accepted', async () => {
      expect((await call('GET', '/users?size=100', admin.token)).status).toBe(200)
    })

    it('[rule-foundation-users-list-admin-only] an ordinary user can no longer list accounts: 403 security.access_denied', async () => {
      const res = await call('GET', '/users', user.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
      expect(JSON.stringify(res.body)).not.toContain('other@example.com')
    })

    it('[rule-foundation-users-list-admin-only] an anonymous caller gets 401', async () => {
      expect((await call('GET', '/users')).status).toBe(401)
    })
  })

  describe('GET /users/:id', () => {
    it('[rule-foundation-users-get-self-or-admin] an ordinary user reads their own account with their groups', async () => {
      await sql('insert into base.group_users (group_id, user_id, created_at) values ($1, $2, now()), ($3, $2, now())', [gA.id, user.id, gB.id])
      const res = await call('GET', `/users/${user.id}`, user.token)
      expect(res.status).toBe(200)
      expect(res.body.user).toEqual({
        id: user.id,
        email: 'user@example.com',
        role: 'user',
        groups: [
          { id: gB.id, name: 'alpha' },
          { id: gA.id, name: 'Beta' },
        ],
      })
    })

    it('[rule-foundation-users-get-self-or-admin] an ordinary user without group reads their account with groups []', async () => {
      const res = await call('GET', `/users/${user.id}`, user.token)
      expect(res.status).toBe(200)
      expect(res.body.user.groups).toEqual([])
    })

    it('[rule-foundation-users-get-self-or-admin] an ordinary user cannot read another existing account: 403', async () => {
      const res = await call('GET', `/users/${other.id}`, user.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
      expect(JSON.stringify(res.body)).not.toContain('other@example.com')
    })

    it('[rule-foundation-users-get-self-or-admin] an ordinary user cannot read an admin account: 403', async () => {
      const res = await call('GET', `/users/${admin.id}`, user.token)
      expect(res.status).toBe(403)
    })

    it('[rule-foundation-users-get-self-or-admin] an ordinary user gets the same 403 for an unknown UUID and for a malformed id', async () => {
      const existing = await call('GET', `/users/${other.id}`, user.token)
      const unknown = await call('GET', `/users/${UNKNOWN_UUID}`, user.token)
      const malformed = await call('GET', '/users/not-a-uuid', user.token)
      expect(unknown.status).toBe(403)
      expect(malformed.status).toBe(403)
      expect(unknown.body.code).toBe(existing.body.code)
      expect(malformed.body.code).toBe(existing.body.code)
    })

    it('[rule-foundation-users-get-self-or-admin] an admin reads any account with its groups', async () => {
      await sql('insert into base.group_users (group_id, user_id, created_at) values ($1, $2, now())', [gA.id, other.id])
      const res = await call('GET', `/users/${other.id}`, admin.token)
      expect(res.status).toBe(200)
      expect(res.body.user).toEqual({ id: other.id, email: 'other@example.com', role: 'user', groups: [{ id: gA.id, name: 'Beta' }] })
      expect((await call('GET', `/users/${admin.id}`, admin.token)).body.user.role).toBe('admin')
    })

    it('[rule-foundation-users-get-self-or-admin] an admin asking an unknown id gets 404 repository.not_found', async () => {
      const res = await call('GET', `/users/${UNKNOWN_UUID}`, admin.token)
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('repository.not_found')
    })

    it('[rule-foundation-users-get-self-or-admin] an admin asking a malformed id gets 400, not 500', async () => {
      const res = await call('GET', '/users/not-a-uuid', admin.token)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-users-get-self-or-admin] an anonymous caller gets 401', async () => {
      expect((await call('GET', `/users/${user.id}`)).status).toBe(401)
    })
  })

  describe('POST /users', () => {
    const body = (over: Record<string, unknown> = {}) => ({ email: 'new@example.com', password: PASSWORD, role: 'user', ...over })

    it('[rule-foundation-user-groups-membership] creates an account without groupIds: no group', async () => {
      const res = await call('POST', '/users', admin.token, body())
      expect(res.status).toBe(201)
      expect(res.body.user).toMatchObject({ email: 'new@example.com', role: 'user', groups: [] })
      expect(Object.keys(res.body.user).sort()).toEqual(['email', 'groups', 'id', 'role'])
    })

    it('[rule-foundation-user-groups-membership] creates accounts with 0, 1 and 2 groups', async () => {
      const zero = await call('POST', '/users', admin.token, body({ email: 'z@example.com', groupIds: [] }))
      expect(zero.status).toBe(201)
      expect(zero.body.user.groups).toEqual([])
      const one = await call('POST', '/users', admin.token, body({ email: 'o@example.com', groupIds: [gA.id] }))
      expect(one.body.user.groups).toEqual([{ id: gA.id, name: 'Beta' }])
      const two = await call('POST', '/users', admin.token, body({ email: 't@example.com', role: 'admin', groupIds: [gA.id, gB.id] }))
      expect(two.status).toBe(201)
      expect(two.body.user.role).toBe('admin')
      expect(two.body.user.groups).toEqual([
        { id: gB.id, name: 'alpha' },
        { id: gA.id, name: 'Beta' },
      ])
      expect(await groupIdsOfUser(two.body.user.id)).toEqual([gA.id, gB.id].sort())
    })

    it('[rule-foundation-user-groups-membership] the new account can log in and reads its own groups', async () => {
      const created = await call('POST', '/users', admin.token, body({ groupIds: [gA.id] }))
      const token = await login('new@example.com', PASSWORD)
      const me = await call('GET', `/users/${created.body.user.id}`, token)
      expect(me.status).toBe(200)
      expect(me.body.user.groups).toEqual([{ id: gA.id, name: 'Beta' }])
    })

    it('[rule-foundation-user-create-fields] e-mail of 254 characters is accepted, 255 rejected', async () => {
      // RFC-valid shapes: local part 64 chars, domain labels at most 63 chars.
      const make = (lastLabel: number) => `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(lastLabel)}`
      const ok = make(61)
      const tooLong = make(62)
      expect(ok).toHaveLength(254)
      expect(tooLong).toHaveLength(255)
      const rejected = await call('POST', '/users', admin.token, body({ email: tooLong }))
      expect(rejected.status).toBe(400)
      expect(rejected.body.code).toBe('api.validation.incoming_failed')
      const res = await call('POST', '/users', admin.token, body({ email: ok }))
      expect(res.status).toBe(201)
      expect(res.body.user.email).toBe(ok)
    })

    it.each([
      [7, 400],
      [8, 201],
      [72, 201],
      [73, 400],
    ])('[rule-foundation-user-create-fields] password of %i characters answers %i', async (len, status) => {
      const res = await call('POST', '/users', admin.token, body({ password: 'p'.repeat(len) }))
      expect(res.status).toBe(status)
      if (status === 400) expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-user-create-fields] a 72-char password can be used to log in', async () => {
      await call('POST', '/users', admin.token, body({ password: 'p'.repeat(72) }))
      expect(typeof (await login('new@example.com', 'p'.repeat(72)))).toBe('string')
    })

    it.each([
      ['invalid role', { role: 'superadmin' }],
      ['missing role', { role: undefined }],
      ['invalid e-mail', { email: 'not-an-email' }],
      ['missing e-mail', { email: undefined }],
      ['missing password', { password: undefined }],
      ['duplicate group ids', () => ({ groupIds: [gA.id, gA.id] })],
      ['malformed group id', { groupIds: ['abc'] }],
      ['groupIds not an array', () => ({ groupIds: gA.id })],
      ['101 group ids', () => ({ groupIds: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`) })],
    ])('[rule-foundation-user-create-fields] %s answers 400 and creates nothing', async (_label, over) => {
      const extra = typeof over === 'function' ? over() : over
      const before = await countUsers()
      const res = await call('POST', '/users', admin.token, body(extra))
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await countUsers()).toBe(before)
    })

    it('[rule-foundation-user-groups-membership] an unknown group id answers 400 and leaves no user, credential or membership', async () => {
      const before = await countUsers()
      const credentialsBefore = (await sql('select 1 from base.credentials')).length
      const membershipsBefore = (await sql('select 1 from base.group_users')).length
      const res = await call('POST', '/users', admin.token, body({ groupIds: [gA.id, UNKNOWN_UUID] }))
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await countUsers()).toBe(before)
      expect((await sql('select 1 from base.credentials')).length).toBe(credentialsBefore)
      expect((await sql('select 1 from base.group_users')).length).toBe(membershipsBefore)
    })

    it('[rule-foundation-user-email-unique] a duplicate e-mail answers 409 users.email_already_exists', async () => {
      const res = await call('POST', '/users', admin.token, body({ email: 'user@example.com' }))
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('users.email_already_exists')
      expect(await countUsers()).toBe(3)
    })

    it('[rule-foundation-user-email-unique] a duplicate e-mail with groupIds leaves no membership', async () => {
      await call('POST', '/users', admin.token, body({ email: 'user@example.com', groupIds: [gA.id] }))
      expect(await sql('select 1 from base.group_users')).toHaveLength(0)
    })

    it('[rule-foundation-user-email-unique] parallel creations with the same e-mail give one 201 and the others 409, never a 500', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/users', admin.token, body({ email: 'race@example.com' }))))
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
      expect(await sql("select 1 from base.users where email = 'race@example.com'")).toHaveLength(1)
    })

    it('[rule-foundation-users-admin-screen] an ordinary user gets 403 and nothing is created', async () => {
      const res = await call('POST', '/users', user.token, body())
      expect(res.status).toBe(403)
      expect(await countUsers()).toBe(3)
    })

    it('[rule-foundation-users-admin-screen] an anonymous caller gets 401 and nothing is created', async () => {
      const res = await call('POST', '/users', undefined, body())
      expect(res.status).toBe(401)
      expect(await countUsers()).toBe(3)
    })
  })

  describe('PATCH /users/:id', () => {
    it('[rule-foundation-users-admin-screen] an admin changes the role of another account', async () => {
      const res = await call('PATCH', `/users/${user.id}`, admin.token, { role: 'admin' })
      expect(res.status).toBe(200)
      expect(res.body.user).toEqual({ id: user.id, email: 'user@example.com', role: 'admin', groups: [] })
      expect((await sql('select role from base.users where id = $1', [user.id]))[0].role).toBe('admin')
    })

    it('[rule-foundation-user-groups-membership] groupIds replaces the memberships entirely; role untouched', async () => {
      await sql('insert into base.group_users (group_id, user_id, created_at) values ($1, $2, now())', [gA.id, user.id])
      const res = await call('PATCH', `/users/${user.id}`, admin.token, { groupIds: [gB.id] })
      expect(res.status).toBe(200)
      expect(res.body.user.role).toBe('user')
      expect(res.body.user.groups).toEqual([{ id: gB.id, name: 'alpha' }])
      expect(await groupIdsOfUser(user.id)).toEqual([gB.id])
    })

    it('[rule-foundation-user-groups-membership] groupIds [] removes every group; other accounts keep theirs', async () => {
      await sql('insert into base.group_users (group_id, user_id, created_at) values ($1, $2, now()), ($1, $3, now())', [gA.id, user.id, other.id])
      const res = await call('PATCH', `/users/${user.id}`, admin.token, { groupIds: [] })
      expect(res.status).toBe(200)
      expect(res.body.user.groups).toEqual([])
      expect(await groupIdsOfUser(user.id)).toEqual([])
      expect(await groupIdsOfUser(other.id)).toEqual([gA.id])
    })

    it('[rule-foundation-user-groups-membership] role and groups can be changed together; the group side sees the member', async () => {
      const res = await call('PATCH', `/users/${user.id}`, admin.token, { role: 'admin', groupIds: [gA.id, gB.id] })
      expect(res.status).toBe(200)
      expect(res.body.user.role).toBe('admin')
      const groups = await call('GET', '/groups', admin.token)
      for (const g of groups.body.groups) expect(g.members.map((m: any) => m.id)).toContain(user.id)
    })

    it('[rule-foundation-user-edit-scope] an empty body is accepted and returns the current account', async () => {
      const res = await call('PATCH', `/users/${user.id}`, admin.token, {})
      expect(res.status).toBe(200)
      expect(res.body.user).toMatchObject({ id: user.id, email: 'user@example.com', role: 'user' })
    })

    it.each([
      [{ email: 'changed@example.com' }],
      [{ password: 'NewPassw0rd!x' }],
      [{ role: 'admin', email: 'changed@example.com' }],
      [{ id: UNKNOWN_UUID }],
      [{ foo: 'bar' }],
    ])('[rule-foundation-user-edit-scope] body %j answers 400 and nothing is changed', async (body) => {
      const res = await call('PATCH', `/users/${user.id}`, admin.token, body)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      const row = (await sql('select email, role from base.users where id = $1', [user.id]))[0]
      expect(row).toEqual({ email: 'user@example.com', role: 'user' })
      expect(typeof (await login('user@example.com', PASSWORD))).toBe('string')
    })

    it.each([
      ['invalid role', { role: 'root' }],
      ['duplicate group ids', () => ({ groupIds: [gA.id, gA.id] })],
      ['malformed group id', { groupIds: ['abc'] }],
      ['groupIds not an array', () => ({ groupIds: gA.id })],
      ['101 group ids', () => ({ groupIds: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`) })],
    ])('[rule-foundation-user-edit-scope] %s answers 400', async (_label, over) => {
      const body = typeof over === 'function' ? over() : over
      const res = await call('PATCH', `/users/${user.id}`, admin.token, body)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-user-groups-membership] an unknown group id answers 400 and neither role nor memberships change (atomicity)', async () => {
      await sql('insert into base.group_users (group_id, user_id, created_at) values ($1, $2, now())', [gA.id, user.id])
      const res = await call('PATCH', `/users/${user.id}`, admin.token, { role: 'admin', groupIds: [gB.id, UNKNOWN_UUID] })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect((await sql('select role from base.users where id = $1', [user.id]))[0].role).toBe('user')
      expect(await groupIdsOfUser(user.id)).toEqual([gA.id])
    })

    it('[rule-foundation-user-own-role-locked] an admin changing their own role gets 409 users.cannot_change_own_role and groups are not applied', async () => {
      const res = await call('PATCH', `/users/${admin.id}`, admin.token, { role: 'user', groupIds: [gA.id] })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('users.cannot_change_own_role')
      expect((await sql('select role from base.users where id = $1', [admin.id]))[0].role).toBe('admin')
      expect(await groupIdsOfUser(admin.id)).toEqual([])
    })

    it('[rule-foundation-user-own-role-locked] an admin sending their current role is accepted, groups applied', async () => {
      const res = await call('PATCH', `/users/${admin.id}`, admin.token, { role: 'admin', groupIds: [gA.id] })
      expect(res.status).toBe(200)
      expect(res.body.user.role).toBe('admin')
      expect(await groupIdsOfUser(admin.id)).toEqual([gA.id])
    })

    it('[rule-foundation-user-own-role-locked] an admin can still change their own groups without sending a role', async () => {
      const res = await call('PATCH', `/users/${admin.id}`, admin.token, { groupIds: [gB.id] })
      expect(res.status).toBe(200)
      expect(await groupIdsOfUser(admin.id)).toEqual([gB.id])
    })

    it('[rule-foundation-users-admin-screen] an unknown id answers 404 repository.not_found', async () => {
      const res = await call('PATCH', `/users/${UNKNOWN_UUID}`, admin.token, { role: 'admin' })
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('repository.not_found')
    })

    it('[rule-foundation-users-admin-screen] a malformed id answers 400', async () => {
      const res = await call('PATCH', '/users/not-a-uuid', admin.token, { role: 'admin' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-users-admin-screen] an ordinary user cannot change an account, not even their own role: 403', async () => {
      const other403 = await call('PATCH', `/users/${other.id}`, user.token, { role: 'admin' })
      expect(other403.status).toBe(403)
      expect(other403.body.code).toBe('security.access_denied')
      const self403 = await call('PATCH', `/users/${user.id}`, user.token, { role: 'admin' })
      expect(self403.status).toBe(403)
      const roles = await sql('select email, role from base.users order by email')
      expect(roles.map((r) => r.role)).toEqual(['admin', 'user', 'user'])
    })

    it('[rule-foundation-users-admin-screen] an anonymous caller gets 401', async () => {
      expect((await call('PATCH', `/users/${user.id}`, undefined, { role: 'admin' })).status).toBe(401)
    })
  })

  describe('no deletion', () => {
    it('[rule-foundation-user-no-delete] DELETE /users/:id does not exist and the account is kept', async () => {
      const res = await call('DELETE', `/users/${user.id}`, admin.token)
      expect(res.status).toBe(404)
      for (const token of [user.token, undefined]) {
        expect([401, 403, 404]).toContain((await call('DELETE', `/users/${user.id}`, token)).status)
      }
      expect(await countUsers()).toBe(3)
    })
  })

  describe('multi-company absence', () => {
    it('[rule-foundation-no-multi-company] user responses carry no company/tenant field', async () => {
      const res = await call('GET', `/users/${user.id}`, admin.token)
      expect(Object.keys(res.body.user).sort()).toEqual(['email', 'groups', 'id', 'role'])
      expect(JSON.stringify(res.body)).not.toMatch(/company|tenant|entreprise/i)
    })
  })

  it('[rule-foundation-user-groups-membership] test helper createUser accounts stay creatable without group (compatibility)', async () => {
    const u = await createUser({ email: 'plain@example.com', password: PASSWORD, role: 'user' })
    const res = await call('GET', `/users/${u.id}`, admin.token)
    expect(res.body.user.groups).toEqual([])
  })
})
