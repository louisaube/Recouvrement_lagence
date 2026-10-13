import { sql, resetData, closePool, createUser } from './harness'
import {
  call,
  userWithToken,
  seedScope,
  seedGroup,
  memberIdsOf,
  scopeIdsOf,
  UNKNOWN_UUID,
  PASSWORD,
} from './scope-helpers'

// Acceptance suite of version socle-groupes-perimetres: groups (groupes).
describe('Groups', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>
  let s1: { id: string; code: string; name: string }
  let s2: { id: string; code: string; name: string }
  let s3: { id: string; code: string; name: string }
  let u1: { id: string; email: string }
  let u2: { id: string; email: string }

  const countGroups = async () => (await sql('select 1 from base.groups')).length

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
    s1 = await seedScope('s1', 'Site 1')
    s2 = await seedScope('s2', 'Site 2')
    s3 = await seedScope('s3', 'Site 3')
    u1 = await createUser({ email: 'm1@example.com', password: PASSWORD, role: 'user' })
    u2 = await createUser({ email: 'm2@example.com', password: PASSWORD, role: 'user' })
  })
  afterAll(async () => {
    await closePool()
  })

  describe('GET /groups', () => {
    it('[rule-foundation-group-definition] lists groups with members sorted by e-mail and scopes sorted by code', async () => {
      await seedGroup('Equipe', { scopeIds: [s3.id, s1.id, s2.id], userIds: [u2.id, u1.id] })
      const res = await call('GET', '/groups', admin.token)
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
      const g = res.body.groups[0]
      expect(Object.keys(g).sort()).toEqual(['id', 'members', 'name', 'scopes'])
      expect(g.name).toBe('Equipe')
      expect(g.members).toEqual([
        { id: u1.id, email: 'm1@example.com' },
        { id: u2.id, email: 'm2@example.com' },
      ])
      expect(g.scopes).toEqual([
        { id: s1.id, code: 's1', name: 'Site 1' },
        { id: s2.id, code: 's2', name: 'Site 2' },
        { id: s3.id, code: 's3', name: 'Site 3' },
      ])
    })

    it('[rule-foundation-group-definition] groups are sorted by name ignoring case', async () => {
      await seedGroup('beta', { scopeIds: [s1.id] })
      await seedGroup('Alpha', { scopeIds: [s1.id] })
      await seedGroup('Charlie', { scopeIds: [s1.id] })
      await seedGroup('alpine', { scopeIds: [s1.id] })
      const res = await call('GET', '/groups', admin.token)
      expect(res.body.groups.map((g: any) => g.name)).toEqual(['Alpha', 'alpine', 'beta', 'Charlie'])
    })

    it('[rule-foundation-group-members-optional] a group without member is listed with an empty members array', async () => {
      await seedGroup('Vide', { scopeIds: [s1.id] })
      const res = await call('GET', '/groups', admin.token)
      expect(res.body.groups[0].members).toEqual([])
    })

    it('[rule-foundation-list-pagination] from and size paginate; total is the full count', async () => {
      for (const n of ['g1', 'g2', 'g3', 'g4', 'g5']) await seedGroup(n, { scopeIds: [s1.id] })
      const res = await call('GET', '/groups?from=1&size=2', admin.token)
      expect(res.status).toBe(200)
      expect(res.body.groups.map((g: any) => g.name)).toEqual(['g2', 'g3'])
      expect(res.body.total).toBe(5)
      const def = await call('GET', '/groups', admin.token)
      expect(def.body.groups).toHaveLength(5)
    })

    it('[rule-foundation-list-pagination] members and scopes of a page belong to the right group', async () => {
      await seedGroup('A', { scopeIds: [s1.id], userIds: [u1.id] })
      await seedGroup('B', { scopeIds: [s2.id], userIds: [u2.id] })
      const res = await call('GET', '/groups', admin.token)
      expect(res.body.groups[0]).toMatchObject({ name: 'A', members: [{ email: 'm1@example.com' }], scopes: [{ code: 's1' }] })
      expect(res.body.groups[1]).toMatchObject({ name: 'B', members: [{ email: 'm2@example.com' }], scopes: [{ code: 's2' }] })
    })

    it.each(['size=0', 'size=101', 'size=-3', 'size=x', 'from=-1', 'from=x'])(
      '[rule-foundation-list-pagination] query %s answers 400 api.validation.incoming_failed',
      async (query) => {
        const res = await call('GET', `/groups?${query}`, admin.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      },
    )

    it('[rule-foundation-groups-admin-screen] an ordinary user gets 403 security.access_denied', async () => {
      const res = await call('GET', '/groups', user.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
    })

    it('[rule-foundation-groups-admin-screen] an anonymous caller gets 401', async () => {
      expect((await call('GET', '/groups')).status).toBe(401)
    })
  })

  describe('POST /groups', () => {
    it('[rule-foundation-group-definition] creates a group with members and scopes in one call', async () => {
      const res = await call('POST', '/groups', admin.token, {
        name: '  Equipe Nord ',
        userIds: [u1.id, u2.id],
        scopeIds: [s2.id, s1.id],
      })
      expect(res.status).toBe(201)
      const g = res.body.group
      expect(g.name).toBe('Equipe Nord')
      expect(g.members.map((m: any) => m.email)).toEqual(['m1@example.com', 'm2@example.com'])
      expect(g.scopes.map((s: any) => s.code)).toEqual(['s1', 's2'])
      expect(await memberIdsOf(g.id)).toEqual([u1.id, u2.id].sort())
      expect(await scopeIdsOf(g.id)).toEqual([s1.id, s2.id].sort())
    })

    it('[rule-foundation-group-members-optional] a group can be created with an empty userIds array', async () => {
      const res = await call('POST', '/groups', admin.token, { name: 'Sans membre', userIds: [], scopeIds: [s1.id] })
      expect(res.status).toBe(201)
      expect(res.body.group.members).toEqual([])
      expect(await memberIdsOf(res.body.group.id)).toEqual([])
    })

    it('[rule-foundation-group-members-optional] userIds may be absent: the group has no member', async () => {
      const res = await call('POST', '/groups', admin.token, { name: 'Sans champ', scopeIds: [s1.id] })
      expect(res.status).toBe(201)
      expect(res.body.group.members).toEqual([])
    })

    it('[rule-foundation-group-needs-scope] an empty scopeIds array answers 400 and nothing is persisted', async () => {
      const res = await call('POST', '/groups', admin.token, { name: 'Sans perimetre', userIds: [u1.id], scopeIds: [] })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await countGroups()).toBe(0)
    })

    it('[rule-foundation-group-needs-scope] a missing scopeIds answers 400', async () => {
      const res = await call('POST', '/groups', admin.token, { name: 'Sans perimetre', userIds: [] })
      expect(res.status).toBe(400)
      expect(await countGroups()).toBe(0)
    })

    it.each([
      ['duplicate scope ids', () => ({ name: 'G', userIds: [], scopeIds: [s1.id, s1.id] })],
      ['duplicate user ids', () => ({ name: 'G', userIds: [u1.id, u1.id], scopeIds: [s1.id] })],
      ['unknown user id', () => ({ name: 'G', userIds: [UNKNOWN_UUID], scopeIds: [s1.id] })],
      ['unknown scope id', () => ({ name: 'G', userIds: [u1.id], scopeIds: [s1.id, UNKNOWN_UUID] })],
      ['malformed user id', () => ({ name: 'G', userIds: ['abc'], scopeIds: [s1.id] })],
      ['malformed scope id', () => ({ name: 'G', userIds: [], scopeIds: ['abc'] })],
      ['user ids not an array', () => ({ name: 'G', userIds: u1.id, scopeIds: [s1.id] })],
      ['201 scope ids', () => ({ name: 'G', userIds: [], scopeIds: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`) })],
      ['1001 user ids', () => ({ name: 'G', userIds: Array.from({ length: 1001 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`), scopeIds: [s1.id] })],
      ['empty name', () => ({ name: '', userIds: [], scopeIds: [s1.id] })],
      ['blank name', () => ({ name: '   ', userIds: [], scopeIds: [s1.id] })],
      ['101-char name', () => ({ name: 'n'.repeat(101), userIds: [], scopeIds: [s1.id] })],
      ['missing name', () => ({ userIds: [], scopeIds: [s1.id] })],
      ['name not a string', () => ({ name: 4, userIds: [], scopeIds: [s1.id] })],
    ])('[rule-foundation-group-needs-scope] [rule-foundation-group-definition] %s answers 400 and nothing is persisted', async (_label, makeBody) => {
      const res = await call('POST', '/groups', admin.token, makeBody())
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await countGroups()).toBe(0)
      expect(await sql('select 1 from base.group_users')).toHaveLength(0)
      expect(await sql('select 1 from base.group_scopes')).toHaveLength(0)
    })

    it('[rule-foundation-group-needs-scope] boundary: a 100-char name and 1 scope are accepted', async () => {
      const res = await call('POST', '/groups', admin.token, { name: 'n'.repeat(100), userIds: [], scopeIds: [s1.id] })
      expect(res.status).toBe(201)
    })

    it('[rule-foundation-group-name-unique] a name differing only by case answers 409 groups.name_already_exists', async () => {
      await seedGroup('Equipe', { scopeIds: [s1.id] })
      for (const name of ['Equipe', 'EQUIPE', 'equipe', '  equipe  ']) {
        const res = await call('POST', '/groups', admin.token, { name, userIds: [], scopeIds: [s1.id] })
        expect(res.status).toBe(409)
        expect(res.body.code).toBe('groups.name_already_exists')
      }
      expect(await countGroups()).toBe(1)
    })

    it('[rule-foundation-group-name-unique] a 409 persists nothing of the request (members, scopes)', async () => {
      await seedGroup('Equipe', { scopeIds: [s1.id] })
      await call('POST', '/groups', admin.token, { name: 'equipe', userIds: [u1.id], scopeIds: [s2.id] })
      expect(await sql('select 1 from base.group_users')).toHaveLength(0)
      expect(await sql('select 1 from base.group_scopes')).toHaveLength(1)
    })

    it('[rule-foundation-group-name-unique] parallel creations of the same name (any case) give one 201 and the others 409, never a 500', async () => {
      const names = ['Course', 'COURSE', 'course', 'CoUrSe']
      const results = await Promise.all(
        names.map((name) => call('POST', '/groups', admin.token, { name, userIds: [], scopeIds: [s1.id] })),
      )
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
      expect(await countGroups()).toBe(1)
    })

    it('[rule-foundation-groups-admin-screen] an ordinary user gets 403 and nothing is created', async () => {
      const res = await call('POST', '/groups', user.token, { name: 'G', userIds: [], scopeIds: [s1.id] })
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
      expect(await countGroups()).toBe(0)
    })

    it('[rule-foundation-groups-admin-screen] an anonymous caller gets 401', async () => {
      const res = await call('POST', '/groups', undefined, { name: 'G', userIds: [], scopeIds: [s1.id] })
      expect(res.status).toBe(401)
      expect(await countGroups()).toBe(0)
    })
  })

  describe('PATCH /groups/:id', () => {
    let group: { id: string; name: string }
    beforeEach(async () => {
      group = await seedGroup('Initial', { scopeIds: [s1.id], userIds: [u1.id] })
    })

    const state = async () => ({
      name: (await sql('select name from base.groups where id = $1', [group.id]))[0]?.name,
      members: await memberIdsOf(group.id),
      scopes: await scopeIdsOf(group.id),
    })

    it('[rule-foundation-group-definition] renaming leaves members and scopes untouched', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, { name: ' Renomme ' })
      expect(res.status).toBe(200)
      expect(res.body.group.name).toBe('Renomme')
      expect(res.body.group.members.map((m: any) => m.id)).toEqual([u1.id])
      expect(res.body.group.scopes.map((s: any) => s.id)).toEqual([s1.id])
      expect(await state()).toEqual({ name: 'Renomme', members: [u1.id], scopes: [s1.id] })
    })

    it('[rule-foundation-group-definition] userIds replaces the whole membership; name and scopes untouched', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, { userIds: [u2.id] })
      expect(res.status).toBe(200)
      expect(res.body.group.members.map((m: any) => m.id)).toEqual([u2.id])
      expect(await state()).toEqual({ name: 'Initial', members: [u2.id], scopes: [s1.id] })
    })

    it('[rule-foundation-group-definition] scopeIds replaces the whole scope set; name and members untouched', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, { scopeIds: [s2.id, s3.id] })
      expect(res.status).toBe(200)
      expect(res.body.group.scopes.map((s: any) => s.code)).toEqual(['s2', 's3'])
      expect(await state()).toEqual({ name: 'Initial', members: [u1.id], scopes: [s2.id, s3.id].sort() })
    })

    it('[rule-foundation-group-definition] name, userIds and scopeIds can be changed together', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, {
        name: 'Tout',
        userIds: [u1.id, u2.id],
        scopeIds: [s3.id],
      })
      expect(res.status).toBe(200)
      expect(await state()).toEqual({ name: 'Tout', members: [u1.id, u2.id].sort(), scopes: [s3.id] })
    })

    it('[rule-foundation-group-members-optional] userIds [] removes every member', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, { userIds: [] })
      expect(res.status).toBe(200)
      expect(res.body.group.members).toEqual([])
      expect((await state()).members).toEqual([])
    })

    it('[rule-foundation-group-needs-scope] scopeIds [] answers 400 and the group is unchanged', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, { name: 'Autre', scopeIds: [] })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await state()).toEqual({ name: 'Initial', members: [u1.id], scopes: [s1.id] })
    })

    it.each([
      ['duplicate user ids', () => ({ userIds: [u2.id, u2.id] })],
      ['duplicate scope ids', () => ({ scopeIds: [s2.id, s2.id] })],
      ['unknown user id', () => ({ userIds: [UNKNOWN_UUID] })],
      ['unknown scope id', () => ({ scopeIds: [UNKNOWN_UUID] })],
      ['malformed ids', () => ({ userIds: ['x'] })],
      ['empty name', () => ({ name: '' })],
      ['blank name', () => ({ name: '  ' })],
      ['101-char name', () => ({ name: 'n'.repeat(101) })],
      ['unknown key', () => ({ name: 'Autre', foo: 'bar' })],
    ])('[rule-foundation-group-definition] %s answers 400 and nothing of the request is applied', async (_label, makeBody) => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, { name: 'Applique', ...makeBody() })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await state()).toEqual({ name: 'Initial', members: [u1.id], scopes: [s1.id] })
    })

    it('[rule-foundation-group-name-unique] renaming to another group name (any case) answers 409 and applies nothing', async () => {
      await seedGroup('Autre', { scopeIds: [s2.id] })
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, {
        name: 'AUTRE',
        userIds: [u2.id],
        scopeIds: [s3.id],
      })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('groups.name_already_exists')
      expect(await state()).toEqual({ name: 'Initial', members: [u1.id], scopes: [s1.id] })
    })

    it('[rule-foundation-group-name-unique] renaming a group to its own name with another case is accepted', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, { name: 'INITIAL' })
      expect(res.status).toBe(200)
      expect(res.body.group.name).toBe('INITIAL')
    })

    it('[rule-foundation-group-definition] an empty body is accepted and has no effect', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, admin.token, {})
      expect(res.status).toBe(200)
      expect(res.body.group.name).toBe('Initial')
      expect(await state()).toEqual({ name: 'Initial', members: [u1.id], scopes: [s1.id] })
    })

    it('[rule-foundation-groups-admin-screen] an unknown id answers 404 repository.not_found', async () => {
      const res = await call('PATCH', `/groups/${UNKNOWN_UUID}`, admin.token, { name: 'X' })
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('repository.not_found')
    })

    it('[rule-foundation-groups-admin-screen] a malformed id answers 400', async () => {
      const res = await call('PATCH', '/groups/not-a-uuid', admin.token, { name: 'X' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-groups-admin-screen] an ordinary user gets 403 and the group is unchanged', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, user.token, { name: 'Pirate', userIds: [] })
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
      expect(await state()).toEqual({ name: 'Initial', members: [u1.id], scopes: [s1.id] })
    })

    it('[rule-foundation-groups-admin-screen] an anonymous caller gets 401', async () => {
      const res = await call('PATCH', `/groups/${group.id}`, undefined, { name: 'Pirate' })
      expect(res.status).toBe(401)
    })

    it('[rule-foundation-user-groups-membership] a membership edited from the group side is visible on the user side', async () => {
      await call('PATCH', `/groups/${group.id}`, admin.token, { userIds: [u2.id] })
      const asAdmin = await call('GET', `/users/${u2.id}`, admin.token)
      expect(asAdmin.body.user.groups).toEqual([{ id: group.id, name: 'Initial' }])
      const former = await call('GET', `/users/${u1.id}`, admin.token)
      expect(former.body.user.groups).toEqual([])
    })
  })

  describe('no deletion', () => {
    it('[rule-foundation-group-no-delete] DELETE /groups/:id does not exist and the group is kept', async () => {
      const g = await seedGroup('Garde', { scopeIds: [s1.id] })
      const res = await call('DELETE', `/groups/${g.id}`, admin.token)
      expect(res.status).toBe(404)
      for (const token of [user.token, undefined]) {
        expect([401, 403, 404]).toContain((await call('DELETE', `/groups/${g.id}`, token)).status)
      }
      expect(await countGroups()).toBe(1)
    })
  })

  describe('multi-company absence', () => {
    it('[rule-foundation-no-multi-company] group responses carry no company/tenant field', async () => {
      const created = await call('POST', '/groups', admin.token, { name: 'G', userIds: [u1.id], scopeIds: [s1.id] })
      expect(Object.keys(created.body.group).sort()).toEqual(['id', 'members', 'name', 'scopes'])
      expect(Object.keys(created.body.group.members[0]).sort()).toEqual(['email', 'id'])
      expect(Object.keys(created.body.group.scopes[0]).sort()).toEqual(['code', 'id', 'name'])
      expect(JSON.stringify(created.body)).not.toMatch(/company|tenant|entreprise/i)
    })
  })
})
