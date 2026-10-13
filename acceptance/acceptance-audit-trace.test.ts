import { sql, resetData, closePool, createUser } from './harness'
import { call, userWithToken, seedScope, seedGroup, UNKNOWN_UUID, PASSWORD } from './scope-helpers'
import { countEntries, allEntries } from './audit-helpers'

// Acceptance suite of version socle-journal-audit: the traces left by the foundation routes
// (POST /users, PATCH /users/:id, POST /scopes, PATCH /scopes/:id, POST /groups, PATCH /groups/:id).
describe('Audit trace of the foundation routes', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let admin2: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>
  let s1: { id: string; code: string; name: string }

  const journal = async (query = '') => {
    const res = await call('GET', `/audit-logs${query}`, admin2.token)
    expect(res.status).toBe(200)
    return res.body as { entries: any[]; total: number }
  }
  const lastOf = async (action: string) => (await journal(`?action=${encodeURIComponent(action)}`)).entries

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    admin2 = await userWithToken('admin2@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
    s1 = await seedScope('s1', 'Site 1')
  })
  afterAll(async () => {
    await closePool()
  })

  describe('successful actions leave exactly one entry', () => {
    it('[rule-foundation-audit-trace-content] [rule-foundation-audit-declarative-route] POST /users: author, date, action, object type and id, no scope, readable summary', async () => {
      const t0 = Date.now()
      const res = await call('POST', '/users', admin.token, { email: 'nouveau@example.com', password: PASSWORD, role: 'user' })
      const t1 = Date.now()
      expect(res.status).toBe(201)
      const j = await journal()
      expect(j.total).toBe(1)
      const e = j.entries[0]
      expect(e.actor).toEqual({ id: admin.id, email: 'admin@example.com' })
      expect(e.action).toBe('users:create')
      expect(e.objectType).toBe('Utilisateur')
      expect(e.objectId).toBe(res.body.user.id)
      expect(e.scope).toBeNull()
      expect(e.summary).toContain('nouveau@example.com')
      expect(e.summary.length).toBeGreaterThan(0)
      expect(e.summary.length).toBeLessThanOrEqual(500)
      const at = Date.parse(e.occurredAt)
      expect(e.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(at).toBeGreaterThanOrEqual(t0 - 5000)
      expect(at).toBeLessThanOrEqual(t1 + 5000)
    })

    it('[rule-foundation-audit-trace-content] PATCH /users/:id: one entry with the target account', async () => {
      const target = await createUser({ email: 'cible@example.com', password: PASSWORD, role: 'user' })
      const res = await call('PATCH', `/users/${target.id}`, admin.token, { role: 'admin' })
      expect(res.status).toBe(200)
      const entries = await lastOf('users:update')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        actor: { id: admin.id, email: 'admin@example.com' },
        action: 'users:update',
        objectType: 'Utilisateur',
        objectId: target.id,
        scope: null,
      })
      expect(entries[0].summary).toContain('cible@example.com')
    })

    it('[rule-foundation-audit-trace-content] POST /scopes: the entry carries the scope code', async () => {
      const res = await call('POST', '/scopes', admin.token, { code: 'creche-1', name: 'Crèche du Parc' })
      expect(res.status).toBe(201)
      const entries = await lastOf('scopes:create')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        actor: { id: admin.id, email: 'admin@example.com' },
        action: 'scopes:create',
        objectType: 'Périmètre',
        objectId: res.body.scope.id,
        scope: 'creche-1',
      })
      expect(entries[0].summary).toContain('Crèche du Parc')
    })

    it('[rule-foundation-audit-trace-content] PATCH /scopes/:id: the entry carries the scope code', async () => {
      const res = await call('PATCH', `/scopes/${s1.id}`, admin.token, { name: 'Nouveau nom' })
      expect(res.status).toBe(200)
      const entries = await lastOf('scopes:update')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ action: 'scopes:update', objectType: 'Périmètre', objectId: s1.id, scope: 's1' })
      expect(entries[0].summary).toContain('Nouveau nom')
    })

    it('[rule-foundation-audit-trace-content] POST /groups: one entry, no scope, summary names the group', async () => {
      const m = await createUser({ email: 'membre@example.com', password: PASSWORD, role: 'user' })
      const res = await call('POST', '/groups', admin.token, { name: 'Équipe A', userIds: [m.id], scopeIds: [s1.id] })
      expect(res.status).toBe(201)
      const entries = await lastOf('groups:create')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        actor: { id: admin.id, email: 'admin@example.com' },
        action: 'groups:create',
        objectType: 'Groupe',
        objectId: res.body.group.id,
        scope: null,
      })
      expect(entries[0].summary).toContain('Équipe A')
    })

    it('[rule-foundation-audit-trace-content] PATCH /groups/:id: one entry, no scope, summary names the group', async () => {
      const g = await seedGroup('Initial', { scopeIds: [s1.id] })
      const res = await call('PATCH', `/groups/${g.id}`, admin.token, { name: 'Renommé' })
      expect(res.status).toBe(200)
      const entries = await lastOf('groups:update')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ action: 'groups:update', objectType: 'Groupe', objectId: g.id, scope: null })
      expect(entries[0].summary).toContain('Renommé')
    })

    it('[rule-foundation-audit-french-screen] summaries are readable French texts naming the kind of change', async () => {
      await call('POST', '/groups', admin.token, { name: 'Équipe B', userIds: [], scopeIds: [s1.id] })
      await call('PATCH', `/scopes/${s1.id}`, admin.token, { name: 'Autre nom' })
      const j = await journal()
      const byAction = Object.fromEntries(j.entries.map((e) => [e.action, e.summary]))
      expect(byAction['groups:create']).toMatch(/cr[ée]ation/i)
      expect(byAction['scopes:update']).toMatch(/modification/i)
      for (const e of j.entries) expect(e.action).toMatch(/^[a-z]+:[a-z]+$/)
    })

    it('[rule-foundation-audit-trace-content] the author is the caller: two admins leave entries under their own identity', async () => {
      await call('POST', '/scopes', admin.token, { code: 'a', name: 'A' })
      await call('POST', '/scopes', admin2.token, { code: 'b', name: 'B' })
      const j = await journal('?size=100')
      const bySc = Object.fromEntries(j.entries.map((e) => [e.scope, e.actor]))
      expect(bySc.a).toEqual({ id: admin.id, email: 'admin@example.com' })
      expect(bySc.b).toEqual({ id: admin2.id, email: 'admin2@example.com' })
    })

    it('[rule-foundation-audit-newest-first] [rule-foundation-audit-ms-precision] successive actions appear newest first and the stored date has millisecond precision', async () => {
      await call('POST', '/scopes', admin.token, { code: 'un', name: 'Un' })
      await call('POST', '/scopes', admin.token, { code: 'deux', name: 'Deux' })
      await call('POST', '/scopes', admin.token, { code: 'trois', name: 'Trois' })
      const j = await journal()
      expect(j.entries.map((e) => e.scope)).toEqual(['trois', 'deux', 'un'])
      const rows = await sql("select occurred_at = date_trunc('milliseconds', occurred_at) as ms from base.audit_logs")
      expect(rows).toHaveLength(3)
      expect(rows.every((r) => r.ms === true)).toBe(true)
    })

    it('[rule-foundation-audit-no-op-traced] a successful PATCH that changes nothing is still traced', async () => {
      const g = await seedGroup('Stable', { scopeIds: [s1.id] })
      const res = await call('PATCH', `/groups/${g.id}`, admin.token, {})
      expect(res.status).toBe(200)
      expect(await lastOf('groups:update')).toHaveLength(1)
    })

    it('[rule-foundation-audit-scope-field] scopes:* entries carry the scope code, users:* and groups:* entries carry no scope', async () => {
      const target = await createUser({ email: 'portee@example.com', password: PASSWORD, role: 'user' })
      const g = await seedGroup('Portée', { scopeIds: [s1.id] })
      expect((await call('POST', '/scopes', admin.token, { code: 'portee-1', name: 'Portée 1' })).status).toBe(201)
      expect((await call('PATCH', `/scopes/${s1.id}`, admin.token, { name: 'Renommé' })).status).toBe(200)
      expect((await call('POST', '/users', admin.token, { email: 'sans-portee@example.com', password: PASSWORD, role: 'user' })).status).toBe(201)
      expect((await call('PATCH', `/users/${target.id}`, admin.token, { role: 'admin' })).status).toBe(200)
      expect((await call('POST', '/groups', admin.token, { name: 'Sans portée', userIds: [], scopeIds: [s1.id] })).status).toBe(201)
      expect((await call('PATCH', `/groups/${g.id}`, admin.token, { name: 'Groupe renommé' })).status).toBe(200)
      const j = await journal('?size=100')
      expect(j.total).toBe(6)
      const scopeByAction = (action: string) => j.entries.filter((e) => e.action === action).map((e) => e.scope)
      expect(scopeByAction('scopes:create')).toEqual(['portee-1'])
      expect(scopeByAction('scopes:update')).toEqual(['s1'])
      expect(scopeByAction('users:create')).toEqual([null])
      expect(scopeByAction('users:update')).toEqual([null])
      expect(scopeByAction('groups:create')).toEqual([null])
      expect(scopeByAction('groups:update')).toEqual([null])
    })

    it('[rule-foundation-audit-trace-content] entries can be found back with the filters (author, action, object type, scope)', async () => {
      await call('POST', '/scopes', admin.token, { code: 'lieu', name: 'Lieu' })
      await call('POST', '/groups', admin2.token, { name: 'G', userIds: [], scopeIds: [s1.id] })
      expect((await journal(`?actorId=${admin.id}`)).entries.map((e) => e.action)).toEqual(['scopes:create'])
      expect((await journal(`?actorId=${admin2.id}`)).entries.map((e) => e.action)).toEqual(['groups:create'])
      expect((await journal('?objectType=' + encodeURIComponent('Périmètre'))).total).toBe(1)
      expect((await journal('?scope=lieu')).total).toBe(1)
      const options = await call('GET', '/audit-logs/filters', admin.token)
      expect(options.body.actions).toEqual(['groups:create', 'scopes:create'])
      expect(options.body.scopes).toEqual(['lieu'])
      expect(options.body.objectTypes).toEqual(['Groupe', 'Périmètre'])
      expect(options.body.actors.map((a: any) => a.email)).toEqual(['admin2@example.com', 'admin@example.com'])
    })
  })

  describe('refused or failed actions leave no entry', () => {
    it('[rule-foundation-audit-atomic-with-action] duplicate creations (409) leave no entry beyond the first', async () => {
      await call('POST', '/scopes', admin.token, { code: 'dup', name: 'Dup' })
      expect((await call('POST', '/scopes', admin.token, { code: 'dup', name: 'Autre' })).status).toBe(409)
      await call('POST', '/groups', admin.token, { name: 'Equipe', userIds: [], scopeIds: [s1.id] })
      expect((await call('POST', '/groups', admin.token, { name: 'EQUIPE', userIds: [], scopeIds: [s1.id] })).status).toBe(409)
      await call('POST', '/users', admin.token, { email: 'dup@example.com', password: PASSWORD, role: 'user' })
      expect((await call('POST', '/users', admin.token, { email: 'dup@example.com', password: PASSWORD, role: 'user' })).status).toBe(409)
      expect(await countEntries()).toBe(3)
    })

    it('[rule-foundation-audit-atomic-with-action] parallel creations of the same scope leave exactly one entry', async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) => call('POST', '/scopes', admin.token, { code: 'race', name: `Course ${i}` })),
      )
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
      expect(await countEntries()).toBe(1)
    })

    it('[rule-foundation-audit-atomic-with-action] validation errors (400) leave no entry', async () => {
      expect((await call('POST', '/scopes', admin.token, { code: 'BAD CODE', name: 'x' })).status).toBe(400)
      expect((await call('POST', '/groups', admin.token, { name: 'G', userIds: [], scopeIds: [] })).status).toBe(400)
      expect((await call('POST', '/users', admin.token, { email: 'pas-un-email', password: PASSWORD, role: 'user' })).status).toBe(400)
      expect((await call('PATCH', `/scopes/${s1.id}`, admin.token, { code: 'new' })).status).toBe(400)
      expect((await call('PATCH', '/groups/not-a-uuid', admin.token, { name: 'x' })).status).toBe(400)
      expect(await countEntries()).toBe(0)
    })

    it('[rule-foundation-audit-atomic-with-action] unknown targets (404) and a refused business rule (409) leave no entry', async () => {
      expect((await call('PATCH', `/groups/${UNKNOWN_UUID}`, admin.token, { name: 'X' })).status).toBe(404)
      expect((await call('PATCH', `/scopes/${UNKNOWN_UUID}`, admin.token, { name: 'X' })).status).toBe(404)
      expect((await call('PATCH', `/users/${UNKNOWN_UUID}`, admin.token, { role: 'user' })).status).toBe(404)
      expect((await call('PATCH', `/users/${admin.id}`, admin.token, { role: 'user' })).status).toBe(409)
      expect(await countEntries()).toBe(0)
    })

    it('[rule-foundation-audit-atomic-with-action] an action rejected for an unknown member or scope leaves neither data nor entry', async () => {
      const res = await call('POST', '/groups', admin.token, { name: 'Fantôme', userIds: [UNKNOWN_UUID], scopeIds: [s1.id] })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      expect(await sql('select 1 from base.groups')).toHaveLength(0)
      expect(await countEntries()).toBe(0)
    })

    it('[rule-foundation-audit-admin-only] an ordinary user acting gets 403 and leaves no entry', async () => {
      const g = await seedGroup('G', { scopeIds: [s1.id] })
      expect((await call('POST', '/users', user.token, { email: 'x@example.com', password: PASSWORD, role: 'user' })).status).toBe(403)
      expect((await call('PATCH', `/users/${user.id}`, user.token, { role: 'admin' })).status).toBe(403)
      expect((await call('POST', '/scopes', user.token, { code: 'x', name: 'X' })).status).toBe(403)
      expect((await call('PATCH', `/scopes/${s1.id}`, user.token, { name: 'X' })).status).toBe(403)
      expect((await call('POST', '/groups', user.token, { name: 'X', userIds: [], scopeIds: [s1.id] })).status).toBe(403)
      expect((await call('PATCH', `/groups/${g.id}`, user.token, { name: 'X' })).status).toBe(403)
      expect(await countEntries()).toBe(0)
    })

    it('[rule-foundation-audit-trace-content] anonymous calls get 401 and leave no entry', async () => {
      const g = await seedGroup('G', { scopeIds: [s1.id] })
      expect((await call('POST', '/users', undefined, { email: 'x@example.com', password: PASSWORD, role: 'user' })).status).toBe(401)
      expect((await call('POST', '/scopes', undefined, { code: 'x', name: 'X' })).status).toBe(401)
      expect((await call('PATCH', `/groups/${g.id}`, undefined, { name: 'X' })).status).toBe(401)
      expect(await countEntries()).toBe(0)
    })
  })

  describe('what is not traced', () => {
    it('[rule-foundation-audit-reads-not-traced] reading lists and records leaves no entry', async () => {
      const g = await seedGroup('G', { scopeIds: [s1.id] })
      for (const path of ['/users', `/users/${admin.id}`, '/scopes', '/groups', '/audit-logs', '/audit-logs/filters']) {
        expect((await call('GET', path, admin.token)).status).toBe(200)
      }
      expect(g.id).toBeTruthy()
      expect(await countEntries()).toBe(0)
    })

    it('[rule-foundation-audit-scope-of-trace] logging in and out leaves no entry', async () => {
      const login = await call('POST', '/auth/login', undefined, { email: 'user@example.com', password: PASSWORD, returnToken: true })
      expect(login.status).toBeLessThan(300)
      expect(await countEntries()).toBe(0)
      const out = await call('POST', '/auth/logout', login.body.token)
      expect(out.status).toBeLessThan(300)
      expect(await countEntries()).toBe(0)
    })
  })

  describe('secrets', () => {
    it('[rule-foundation-audit-summary-no-secret] a created account password, its hash and tokens appear nowhere in the journal', async () => {
      const secret = 'S3cret-Passw0rd!'
      const res = await call('POST', '/users', admin.token, { email: 'secret@example.com', password: secret, role: 'user' })
      expect(res.status).toBe(201)
      const hashes = await sql('select password_hash as h from base.credentials', []).catch(() => [] as any[])
      const dump = (await sql('select a::text as t from base.audit_logs a')).map((r) => r.t).join('\n')
      expect(dump.length).toBeGreaterThan(0)
      expect(dump).not.toContain(secret)
      expect(dump).not.toContain(admin.token)
      expect(dump).not.toMatch(/\$2[aby]\$\d{2}\$/)
      for (const h of hashes) if (h.h) expect(dump).not.toContain(h.h)
      const api = JSON.stringify(await journal())
      expect(api).not.toContain(secret)
      expect(api).not.toMatch(/\$2[aby]\$\d{2}\$/)
    })
  })

  describe('survival of the author', () => {
    it('[rule-foundation-audit-survives-author-deletion] after the author account is deleted, entries, list and filter options are unchanged', async () => {
      const author = await userWithToken('auteur@example.com', 'admin')
      await call('POST', '/scopes', author.token, { code: 'trace', name: 'Trace' })
      await call('POST', '/groups', author.token, { name: 'Groupe trace', userIds: [], scopeIds: [s1.id] })
      const beforeRows = await allEntries()
      const beforeList = await journal(`?actorId=${author.id}`)
      const beforeFilters = (await call('GET', '/audit-logs/filters', admin2.token)).body
      expect(beforeList.total).toBe(2)

      await sql('delete from base.credentials where user_id = $1', [author.id])
      await sql('delete from base.group_users where user_id = $1', [author.id])
      await sql('delete from base.users where id = $1', [author.id])
      expect(await sql('select 1 from base.users where id = $1', [author.id])).toHaveLength(0)

      expect(await allEntries()).toEqual(beforeRows)
      expect(await journal(`?actorId=${author.id}`)).toEqual(beforeList)
      expect((await call('GET', '/audit-logs/filters', admin2.token)).body).toEqual(beforeFilters)
      expect(beforeList.entries[0].actor).toEqual({ id: author.id, email: 'auteur@example.com' })
      expect(beforeFilters.actors).toContainEqual({ id: author.id, email: 'auteur@example.com' })
    })
  })
})
