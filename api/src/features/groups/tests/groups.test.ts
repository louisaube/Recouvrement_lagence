import { call, closePool, createUser, login, resetData, sql } from '../../../platform/testing/helpers'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'
const fakeIds = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)

describe('groups routes', () => {
  let admin: string
  let user: string
  let s1: { id: string }
  let s2: { id: string }
  let s3: { id: string }
  let u1: { id: string }
  let u2: { id: string }
  const send = (path: string, token: string | undefined, method = 'GET', body?: unknown) =>
    call(path, { method, body, headers: token ? { authorization: `Bearer ${token}` } : {} })
  const seedScope = async (code: string) =>
    (await sql<{ id: string }>('insert into base.scopes (code, name) values ($1, $1) returning id', [code]))[0]
  const seedGroup = async (name: string, scopeIds: string[], userIds: string[] = []) => {
    const [group] = await sql<{ id: string }>('insert into base.groups (name) values ($1) returning id', [name])
    for (const id of scopeIds) await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2)', [group.id, id])
    for (const id of userIds) await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [group.id, id])
    return group
  }
  const state = async (groupId: string) => ({
    name: (await sql('select name from base.groups where id = $1', [groupId]))[0]?.name,
    members: (await sql('select user_id from base.group_users where group_id = $1 order by user_id', [groupId])).map((r) => r.user_id),
    scopes: (await sql('select scope_id from base.group_scopes where group_id = $1 order by scope_id', [groupId])).map((r) => r.scope_id),
  })

  beforeEach(async () => {
    await resetData()
    await createUser({ email: 'admin@example.com', role: 'admin' })
    await createUser({ email: 'user@example.com', role: 'user' })
    u1 = await createUser({ email: 'm1@example.com' })
    u2 = await createUser({ email: 'm2@example.com' })
    admin = await login('admin@example.com')
    user = await login('user@example.com')
    s1 = await seedScope('s1')
    s2 = await seedScope('s2')
    s3 = await seedScope('s3')
  })
  afterAll(closePool)

  describe('GET /groups', () => {
    it('[rule-foundation-group-definition] groups by name ignoring case, members by e-mail, scopes by code', async () => {
      await seedGroup('beta', [s3.id, s1.id], [u2.id, u1.id])
      await seedGroup('Alpha', [s2.id])
      await seedGroup('alpine', [s1.id])
      const body = await (await send('/groups', admin)).json()
      expect(body.total).toBe(3)
      expect(body.groups.map((g: any) => g.name)).toEqual(['Alpha', 'alpine', 'beta'])
      const beta = body.groups[2]
      expect(Object.keys(beta).sort()).toEqual(['id', 'members', 'name', 'scopes'])
      expect(beta.members.map((m: any) => m.email)).toEqual(['m1@example.com', 'm2@example.com'])
      expect(beta.scopes.map((s: any) => s.code)).toEqual(['s1', 's3'])
      expect(body.groups[0].members).toEqual([])
    })

    it('[rule-foundation-list-pagination] pages carry the right members and scopes; total is the full count', async () => {
      for (const [name, scope, member] of [['A', s1, u1], ['B', s2, u2], ['C', s3, u1]] as const) {
        await seedGroup(name, [scope.id], [member.id])
      }
      const page = await (await send('/groups?from=1&size=1', admin)).json()
      expect(page.total).toBe(3)
      expect(page.groups).toHaveLength(1)
      expect(page.groups[0]).toMatchObject({ name: 'B', members: [{ id: u2.id }], scopes: [{ id: s2.id }] })
    })

    it.each(['size=0', 'size=101', 'from=-1', 'size=x'])('[rule-foundation-list-pagination] query %s is 400', async (query) => {
      expect((await send(`/groups?${query}`, admin)).status).toBe(400)
    })

    it('[rule-foundation-groups-admin-screen] 403 for a user, 401 for a visitor', async () => {
      expect((await send('/groups', user)).status).toBe(403)
      expect((await send('/groups', undefined)).status).toBe(401)
    })
  })

  describe('POST /groups', () => {
    it('[rule-foundation-group-definition] creates name, members and scopes together; the name is trimmed', async () => {
      const res = await send('/groups', admin, 'POST', { name: '  Équipe Nord ', userIds: [u2.id, u1.id], scopeIds: [s2.id, s1.id] })
      expect(res.status).toBe(201)
      const { group } = await res.json()
      expect(group.name).toBe('Équipe Nord')
      expect(group.members.map((m: any) => m.email)).toEqual(['m1@example.com', 'm2@example.com'])
      expect(group.scopes.map((s: any) => s.code)).toEqual(['s1', 's2'])
    })

    it('[rule-foundation-group-members-optional] userIds may be absent or empty', async () => {
      const absent = await send('/groups', admin, 'POST', { name: 'A', scopeIds: [s1.id] })
      const empty = await send('/groups', admin, 'POST', { name: 'B', userIds: [], scopeIds: [s1.id] })
      expect((await absent.json()).group.members).toEqual([])
      expect((await empty.json()).group.members).toEqual([])
    })

    it.each([
      ['no scope', () => ({ name: 'G', scopeIds: [] })],
      ['missing scopeIds', () => ({ name: 'G' })],
      ['duplicate scopes', () => ({ name: 'G', scopeIds: [s1.id, s1.id] })],
      ['unknown scope', () => ({ name: 'G', scopeIds: [s1.id, UNKNOWN] })],
      ['201 scopes', () => ({ name: 'G', scopeIds: fakeIds(201) })],
      ['duplicate users', () => ({ name: 'G', userIds: [u1.id, u1.id], scopeIds: [s1.id] })],
      ['unknown user', () => ({ name: 'G', userIds: [UNKNOWN], scopeIds: [s1.id] })],
      ['1001 users', () => ({ name: 'G', userIds: fakeIds(1001), scopeIds: [s1.id] })],
      ['malformed id', () => ({ name: 'G', userIds: ['abc'], scopeIds: [s1.id] })],
      ['blank name', () => ({ name: '  ', scopeIds: [s1.id] })],
      ['101-character name', () => ({ name: 'n'.repeat(101), scopeIds: [s1.id] })],
    ])('[rule-foundation-group-needs-scope] %s is 400 and nothing is written', async (_label, make) => {
      const res = await send('/groups', admin, 'POST', make())
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('api.validation.incoming_failed')
      for (const table of ['groups', 'group_users', 'group_scopes']) {
        expect(await sql(`select 1 from base.${table}`)).toHaveLength(0)
      }
    })

    it('[rule-foundation-group-name-unique] a name equal ignoring case is 409 and writes nothing of the request', async () => {
      await seedGroup('Équipe', [s1.id])
      const res = await send('/groups', admin, 'POST', { name: ' équipe ', userIds: [u1.id], scopeIds: [s2.id] })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('groups.name_already_exists')
      expect(await sql('select 1 from base.group_users')).toHaveLength(0)
      expect(await sql('select 1 from base.group_scopes')).toHaveLength(1)
    })

    it('[rule-foundation-group-name-unique] simultaneous creations of one name give one 201 and the rest 409', async () => {
      const results = await Promise.all(
        ['Course', 'COURSE', 'course', 'CoUrSe'].map((name) => send('/groups', admin, 'POST', { name, scopeIds: [s1.id] })),
      )
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
    })

    it('[rule-foundation-groups-admin-screen] 403 for a user, 401 for a visitor', async () => {
      expect((await send('/groups', user, 'POST', { name: 'G', scopeIds: [s1.id] })).status).toBe(403)
      expect((await send('/groups', undefined, 'POST', { name: 'G', scopeIds: [s1.id] })).status).toBe(401)
      expect(await sql('select 1 from base.groups')).toHaveLength(0)
    })
  })

  describe('PATCH /groups/:id', () => {
    let group: { id: string }
    beforeEach(async () => {
      group = await seedGroup('Initial', [s1.id], [u1.id])
    })
    const initial = () => ({ name: 'Initial', members: [u1.id], scopes: [s1.id] })

    it('[rule-foundation-group-definition] each provided field replaces the current value; absent ones are unchanged', async () => {
      expect((await send(`/groups/${group.id}`, admin, 'PATCH', { name: ' Renommé ' })).status).toBe(200)
      expect(await state(group.id)).toEqual({ ...initial(), name: 'Renommé' })
      await send(`/groups/${group.id}`, admin, 'PATCH', { userIds: [u2.id] })
      expect(await state(group.id)).toEqual({ name: 'Renommé', members: [u2.id], scopes: [s1.id] })
      await send(`/groups/${group.id}`, admin, 'PATCH', { scopeIds: [s2.id, s3.id] })
      expect((await state(group.id)).scopes).toEqual([s2.id, s3.id].sort())
      const all = await send(`/groups/${group.id}`, admin, 'PATCH', { name: 'Tout', userIds: [], scopeIds: [s1.id] })
      expect((await all.json()).group).toMatchObject({ name: 'Tout', members: [], scopes: [{ id: s1.id }] })
    })

    it('[rule-foundation-group-definition] an empty body changes nothing', async () => {
      const res = await send(`/groups/${group.id}`, admin, 'PATCH', {})
      expect(res.status).toBe(200)
      expect(await state(group.id)).toEqual(initial())
    })

    it.each([
      ['empty scopes', { scopeIds: [] }],
      ['unknown scope', { scopeIds: [UNKNOWN] }],
      ['unknown user', { userIds: [UNKNOWN] }],
      ['duplicate users', () => ({ userIds: [u2.id, u2.id] })],
      ['blank name', { name: ' ' }],
      ['unknown key', { foo: 'bar' }],
    ])('[rule-foundation-group-needs-scope] %s is 400 and nothing of the request is applied', async (_label, extra) => {
      const res = await send(`/groups/${group.id}`, admin, 'PATCH', {
        name: 'Appliqué',
        ...(typeof extra === 'function' ? extra() : extra),
      })
      expect(res.status).toBe(400)
      expect(await state(group.id)).toEqual(initial())
    })

    it('[rule-foundation-group-name-unique] a rename to another name (any case) is 409 and applies nothing', async () => {
      await seedGroup('Autre', [s2.id])
      const res = await send(`/groups/${group.id}`, admin, 'PATCH', { name: 'AUTRE', userIds: [u2.id], scopeIds: [s3.id] })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('groups.name_already_exists')
      expect(await state(group.id)).toEqual(initial())
    })

    it('[rule-foundation-group-name-unique] a rename to its own name with another case is accepted', async () => {
      const res = await send(`/groups/${group.id}`, admin, 'PATCH', { name: 'INITIAL' })
      expect((await res.json()).group.name).toBe('INITIAL')
    })

    it('[rule-foundation-group-definition] concurrent modifications of one group do not interleave', async () => {
      const results = await Promise.all(
        [0, 1, 2, 3, 4, 5].map((i) =>
          send(`/groups/${group.id}`, admin, 'PATCH', { userIds: i % 2 ? [u1.id] : [u2.id], scopeIds: i % 2 ? [s1.id] : [s2.id] }),
        ),
      )
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200])
      const final = await state(group.id)
      // both sets come from the same request: (u1, s1) or (u2, s2)
      expect([JSON.stringify([[u1.id], [s1.id]]), JSON.stringify([[u2.id], [s2.id]])]).toContain(
        JSON.stringify([final.members, final.scopes]),
      )
    })

    it('[rule-foundation-group-definition] the existence of the group (404) is checked before the referenced ids (400)', async () => {
      const res = await send(`/groups/${UNKNOWN}`, admin, 'PATCH', { userIds: [UNKNOWN] })
      expect(res.status).toBe(404)
      expect((await res.json()).code).toBe('repository.not_found')
    })

    it('[rule-foundation-groups-admin-screen] malformed id is 400; 403 for a user; 401 for a visitor', async () => {
      expect((await send('/groups/not-a-uuid', admin, 'PATCH', { name: 'x' })).status).toBe(400)
      expect((await send(`/groups/${group.id}`, user, 'PATCH', { name: 'x' })).status).toBe(403)
      expect((await send(`/groups/${group.id}`, undefined, 'PATCH', { name: 'x' })).status).toBe(401)
      expect(await state(group.id)).toEqual(initial())
    })

    it('[rule-foundation-user-groups-membership] a membership edited from the group is seen from the account', async () => {
      await send(`/groups/${group.id}`, admin, 'PATCH', { userIds: [u2.id] })
      const second = (await (await send(`/users/${u2.id}`, admin)).json()).user
      const first = (await (await send(`/users/${u1.id}`, admin)).json()).user
      expect(second.groups).toEqual([{ id: group.id, name: 'Initial' }])
      expect(first.groups).toEqual([])
    })
  })

  it('[rule-foundation-group-no-delete] DELETE /groups/:id answers 404 and keeps the group', async () => {
    const group = await seedGroup('Garde', [s1.id])
    expect((await send(`/groups/${group.id}`, admin, 'DELETE')).status).toBe(404)
    expect(await sql('select 1 from base.groups')).toHaveLength(1)
  })

  it('[rule-foundation-no-multi-company] a group carries exactly { id, name, members, scopes }', async () => {
    const { group } = await (await send('/groups', admin, 'POST', { name: 'G', userIds: [u1.id], scopeIds: [s1.id] })).json()
    expect(Object.keys(group).sort()).toEqual(['id', 'members', 'name', 'scopes'])
    expect(Object.keys(group.members[0]).sort()).toEqual(['email', 'id'])
    expect(Object.keys(group.scopes[0]).sort()).toEqual(['code', 'id', 'name'])
  })
})
