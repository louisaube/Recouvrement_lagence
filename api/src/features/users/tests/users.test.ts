import { PASSWORD, call, closePool, createUser, login, resetData, sql } from '../../../platform/testing/helpers'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'
const fakeIds = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)

describe('users routes', () => {
  let admin: { id: string; token: string }
  let user: { id: string; token: string }
  let other: { id: string; token: string }
  let gBeta: { id: string }
  let gAlpha: { id: string }
  const send = (path: string, token: string | undefined, method = 'GET', body?: unknown) =>
    call(path, { method, body, headers: token ? { authorization: `Bearer ${token}` } : {} })
  const account = async (email: string, role: 'user' | 'admin') => {
    const created = await createUser({ email, role })
    return { id: created.id, token: await login(email) }
  }
  const seedGroup = async (name: string) => {
    const [scope] = await sql<{ id: string }>("insert into base.scopes (code, name) values ('s-' || $1, 'S') on conflict do nothing returning id", [name.toLowerCase()])
    const [group] = await sql<{ id: string }>('insert into base.groups (name) values ($1) returning id', [name])
    if (scope) await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2)', [group.id, scope.id])
    return group
  }
  const groupsOf = async (userId: string) =>
    (await sql('select group_id from base.group_users where user_id = $1 order by group_id', [userId])).map((r) => r.group_id)
  const body = (over: Record<string, unknown> = {}) => ({ email: 'new@example.com', password: PASSWORD, role: 'user', ...over })

  beforeEach(async () => {
    await resetData()
    admin = await account('admin@example.com', 'admin')
    user = await account('user@example.com', 'user')
    other = await account('other@example.com', 'user')
    gBeta = await seedGroup('Beta')
    gAlpha = await seedGroup('alpha')
  })
  afterAll(closePool)

  describe('GET /users', () => {
    it('[rule-foundation-users-list-admin-only] accounts sorted by e-mail, groups sorted by name ignoring case', async () => {
      await sql('insert into base.group_users (group_id, user_id) values ($1, $3), ($2, $3)', [gBeta.id, gAlpha.id, user.id])
      const res = await send('/users', admin.token)
      expect(res.status).toBe(200)
      const list = await res.json()
      expect(list.total).toBe(3)
      expect(list.users.map((u: any) => u.email)).toEqual(['admin@example.com', 'other@example.com', 'user@example.com'])
      const found = list.users.find((u: any) => u.email === 'user@example.com')
      expect(Object.keys(found).sort()).toEqual(['email', 'groups', 'id', 'role'])
      expect(found.groups).toEqual([{ id: gAlpha.id, name: 'alpha' }, { id: gBeta.id, name: 'Beta' }])
    })

    it('[rule-foundation-list-pagination] from and size, total independent of the page', async () => {
      const page = await (await send('/users?from=1&size=1', admin.token)).json()
      expect(page.users.map((u: any) => u.email)).toEqual(['other@example.com'])
      expect(page.total).toBe(3)
      expect((await send('/users?size=100', admin.token)).status).toBe(200)
    })

    it.each(['size=0', 'size=101', 'from=-1', 'from=x', 'size=1.5'])('[rule-foundation-list-pagination] query %s is 400', async (q) => {
      const res = await send(`/users?${q}`, admin.token)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-users-list-admin-only] 403 for a user (no e-mail leaked), 401 for a visitor', async () => {
      const res = await send('/users', user.token)
      expect(res.status).toBe(403)
      expect(JSON.stringify(await res.json())).not.toContain('example.com')
      expect((await send('/users', undefined)).status).toBe(401)
    })
  })

  describe('GET /users/:id', () => {
    it('[rule-foundation-users-get-self-or-admin] a user reads their own account with their groups', async () => {
      await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [gBeta.id, user.id])
      const res = await send(`/users/${user.id}`, user.token)
      expect(res.status).toBe(200)
      expect((await res.json()).user).toEqual({ id: user.id, email: 'user@example.com', role: 'user', groups: [{ id: gBeta.id, name: 'Beta' }] })
    })

    it('[rule-foundation-users-get-self-or-admin] a user gets the same 403 on another account, an unknown id and a malformed id', async () => {
      const bodies = []
      for (const id of [other.id, admin.id, UNKNOWN, 'not-a-uuid']) {
        const res = await send(`/users/${id}`, user.token)
        expect(res.status).toBe(403)
        bodies.push(await res.json())
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
      expect(bodies[0].code).toBe('security.access_denied')
    })

    it('[rule-foundation-users-get-self-or-admin] an administrator reads any account; 404 unknown; 400 malformed', async () => {
      expect((await (await send(`/users/${other.id}`, admin.token)).json()).user.email).toBe('other@example.com')
      const unknown = await send(`/users/${UNKNOWN}`, admin.token)
      expect(unknown.status).toBe(404)
      expect((await unknown.json()).code).toBe('repository.not_found')
      expect((await send('/users/not-a-uuid', admin.token)).status).toBe(400)
    })

    it('[rule-foundation-users-get-self-or-admin] 401 for a visitor', async () => {
      expect((await send(`/users/${user.id}`, undefined)).status).toBe(401)
    })
  })

  describe('POST /users', () => {
    it('[rule-foundation-user-groups-membership] creates accounts with 0, 1 and 2 groups, groups sorted by name', async () => {
      const none = await send('/users', admin.token, 'POST', body())
      expect(none.status).toBe(201)
      expect((await none.json()).user.groups).toEqual([])
      const two = await send('/users', admin.token, 'POST', body({ email: 'two@example.com', groupIds: [gBeta.id, gAlpha.id] }))
      const created = (await two.json()).user
      expect(created.groups).toEqual([{ id: gAlpha.id, name: 'alpha' }, { id: gBeta.id, name: 'Beta' }])
      expect(await groupsOf(created.id)).toEqual([gAlpha.id, gBeta.id].sort())
    })

    it('[rule-foundation-user-create-fields] only the hash is stored, and the account can log in', async () => {
      await send('/users', admin.token, 'POST', body({ password: 'p'.repeat(72) }))
      const [credential] = await sql("select password from base.credentials c join base.users u on u.id = c.user_id where u.email = 'new@example.com'")
      expect(credential.password).toMatch(/^\$2[aby]\$10\$/)
      expect(typeof (await login('new@example.com', 'p'.repeat(72)))).toBe('string')
    })

    it.each([
      [7, 400],
      [8, 201],
      [72, 201],
      [73, 400],
    ])('[rule-foundation-user-create-fields] a password of %i characters answers %i', async (length, status) => {
      expect((await send('/users', admin.token, 'POST', body({ password: 'p'.repeat(length) }))).status).toBe(status)
    })

    it.each([
      ['invalid role', { role: 'root' }],
      ['invalid e-mail', { email: 'not-an-email' }],
      ['duplicate group ids', () => ({ groupIds: [gAlpha.id, gAlpha.id] })],
      ['malformed group id', { groupIds: ['abc'] }],
      ['101 group ids', () => ({ groupIds: fakeIds(101) })],
      ['unknown group', () => ({ groupIds: [gAlpha.id, UNKNOWN] })],
    ])('[rule-foundation-user-create-fields] %s is 400 and leaves no account, secret or membership', async (_label, over) => {
      const res = await send('/users', admin.token, 'POST', body(typeof over === 'function' ? over() : over))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('api.validation.incoming_failed')
      expect(await sql('select 1 from base.users')).toHaveLength(3)
      expect(await sql('select 1 from base.credentials')).toHaveLength(3)
      expect(await sql('select 1 from base.group_users')).toHaveLength(0)
    })

    it('[rule-foundation-user-email-unique] a used e-mail (case-sensitive) is 409 without orphan membership', async () => {
      const res = await send('/users', admin.token, 'POST', body({ email: 'user@example.com', groupIds: [gAlpha.id] }))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('users.email_already_exists')
      expect(await sql('select 1 from base.group_users')).toHaveLength(0)
      expect((await send('/users', admin.token, 'POST', body({ email: 'User@example.com' }))).status).toBe(201)
    })

    it('[rule-foundation-user-email-unique] four simultaneous creations give one 201 and three 409', async () => {
      const results = await Promise.all([1, 2, 3, 4].map(() => send('/users', admin.token, 'POST', body({ email: 'race@example.com' }))))
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
    })

    it('[rule-foundation-users-admin-screen] 403 for a user, 401 for a visitor, nothing created', async () => {
      expect((await send('/users', user.token, 'POST', body())).status).toBe(403)
      expect((await send('/users', undefined, 'POST', body())).status).toBe(401)
      expect(await sql('select 1 from base.users')).toHaveLength(3)
    })
  })

  describe('PATCH /users/:id', () => {
    it('[rule-foundation-users-admin-screen] changes the role of another account', async () => {
      const res = await send(`/users/${user.id}`, admin.token, 'PATCH', { role: 'admin' })
      expect(res.status).toBe(200)
      expect((await res.json()).user).toEqual({ id: user.id, email: 'user@example.com', role: 'admin', groups: [] })
    })

    it('[rule-foundation-user-groups-membership] groupIds replaces the memberships; [] removes them; absent leaves them', async () => {
      await sql('insert into base.group_users (group_id, user_id) values ($1, $2), ($1, $3)', [gBeta.id, user.id, other.id])
      await send(`/users/${user.id}`, admin.token, 'PATCH', { groupIds: [gAlpha.id] })
      expect(await groupsOf(user.id)).toEqual([gAlpha.id])
      await send(`/users/${user.id}`, admin.token, 'PATCH', { role: 'admin' })
      expect(await groupsOf(user.id)).toEqual([gAlpha.id])
      await send(`/users/${user.id}`, admin.token, 'PATCH', { groupIds: [] })
      expect(await groupsOf(user.id)).toEqual([])
      expect(await groupsOf(other.id)).toEqual([gBeta.id])
    })

    it('[rule-foundation-user-edit-scope] an empty body is accepted and changes nothing', async () => {
      const res = await send(`/users/${user.id}`, admin.token, 'PATCH', {})
      expect(res.status).toBe(200)
      expect((await res.json()).user).toMatchObject({ id: user.id, role: 'user' })
    })

    it.each([[{ email: 'x@example.com' }], [{ password: 'NewPassw0rd!x' }], [{ role: 'admin', id: UNKNOWN }], [{ foo: 1 }]])(
      '[rule-foundation-user-edit-scope] body %j is 400, nothing changes and the password still works',
      async (patch) => {
        const res = await send(`/users/${user.id}`, admin.token, 'PATCH', patch)
        expect(res.status).toBe(400)
        expect(await sql('select email, role from base.users where id = $1', [user.id])).toEqual([{ email: 'user@example.com', role: 'user' }])
        expect(typeof (await login('user@example.com'))).toBe('string')
      },
    )

    it('[rule-foundation-user-groups-membership] an unknown group is 400 and the role and memberships are untouched (atomic)', async () => {
      await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [gBeta.id, user.id])
      const res = await send(`/users/${user.id}`, admin.token, 'PATCH', { role: 'admin', groupIds: [gAlpha.id, UNKNOWN] })
      expect(res.status).toBe(400)
      expect((await sql('select role from base.users where id = $1', [user.id]))[0].role).toBe('user')
      expect(await groupsOf(user.id)).toEqual([gBeta.id])
    })

    it('[rule-foundation-user-own-role-locked] an administrator changing their own role gets 409 and nothing is applied', async () => {
      const res = await send(`/users/${admin.id}`, admin.token, 'PATCH', { role: 'user', groupIds: [gBeta.id] })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('users.cannot_change_own_role')
      expect((await sql('select role from base.users where id = $1', [admin.id]))[0].role).toBe('admin')
      expect(await groupsOf(admin.id)).toEqual([])
    })

    it('[rule-foundation-user-own-role-locked] their current role, or their groups alone, are accepted', async () => {
      expect((await send(`/users/${admin.id}`, admin.token, 'PATCH', { role: 'admin', groupIds: [gBeta.id] })).status).toBe(200)
      expect((await send(`/users/${admin.id}`, admin.token, 'PATCH', { groupIds: [gAlpha.id] })).status).toBe(200)
      expect(await groupsOf(admin.id)).toEqual([gAlpha.id])
    })

    it('[rule-foundation-user-own-role-locked] the lock holds when the identifier of the path is written in capitals', async () => {
      const res = await send(`/users/${admin.id.toUpperCase()}`, admin.token, 'PATCH', { role: 'user' })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('users.cannot_change_own_role')
      expect((await sql('select role from base.users where id = $1', [admin.id]))[0].role).toBe('admin')
    })

    it('[rule-foundation-users-admin-screen] an identifier in capitals reads and modifies the account (never a 404 or an empty body)', async () => {
      const read = await send(`/users/${user.id.toUpperCase()}`, admin.token)
      expect(read.status).toBe(200)
      expect((await read.json()).user.id).toBe(user.id)
      const patched = await send(`/users/${user.id.toUpperCase()}`, admin.token, 'PATCH', { groupIds: [gAlpha.id.toUpperCase()] })
      expect(patched.status).toBe(200)
      expect((await patched.json()).user).toMatchObject({ id: user.id, groups: [{ id: gAlpha.id }] })
      const twice = await send(`/users/${user.id}`, admin.token, 'PATCH', { groupIds: [gAlpha.id, gAlpha.id.toUpperCase()] })
      expect(twice.status).toBe(400)
    })

    it('[rule-foundation-user-groups-membership] accounts and groups rewritten at the same time never deadlock (no 500)', async () => {
      await sql('insert into base.group_users (group_id, user_id) values ($1, $3), ($2, $3), ($1, $4), ($2, $4)', [
        gBeta.id,
        gAlpha.id,
        user.id,
        other.id,
      ])
      const results = await Promise.all(
        [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
          i % 2
            ? send(`/users/${i % 4 === 1 ? user.id : other.id}`, admin.token, 'PATCH', { groupIds: i % 3 ? [gAlpha.id, gBeta.id] : [gBeta.id] })
            : send(`/groups/${i % 4 === 0 ? gAlpha.id : gBeta.id}`, admin.token, 'PATCH', { userIds: i % 3 ? [user.id, other.id] : [other.id] }),
        ),
      )
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200))
    })

    it('[rule-foundation-users-admin-screen] 404 unknown id, 400 malformed id, 403 for a user, 401 for a visitor', async () => {
      const unknown = await send(`/users/${UNKNOWN}`, admin.token, 'PATCH', { role: 'admin' })
      expect(unknown.status).toBe(404)
      expect((await unknown.json()).code).toBe('repository.not_found')
      expect((await send('/users/not-a-uuid', admin.token, 'PATCH', { role: 'admin' })).status).toBe(400)
      expect((await send(`/users/${user.id}`, user.token, 'PATCH', { role: 'admin' })).status).toBe(403)
      expect((await send(`/users/${user.id}`, undefined, 'PATCH', { role: 'admin' })).status).toBe(401)
      expect((await sql('select role from base.users where id = $1', [user.id]))[0].role).toBe('user')
    })
  })

  it('[rule-foundation-user-no-delete] DELETE /users/:id answers 404 and keeps the account', async () => {
    expect((await send(`/users/${user.id}`, admin.token, 'DELETE')).status).toBe(404)
    expect(await sql('select 1 from base.users')).toHaveLength(3)
  })

  it('[rule-foundation-no-multi-company] an account carries exactly { id, email, role, groups }', async () => {
    const res = await (await send(`/users/${user.id}`, admin.token)).json()
    expect(Object.keys(res.user).sort()).toEqual(['email', 'groups', 'id', 'role'])
    expect(JSON.stringify(res)).not.toMatch(/company|tenant|entreprise/i)
  })
})
