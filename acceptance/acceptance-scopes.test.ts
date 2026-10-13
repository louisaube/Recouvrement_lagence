import { sql, resetData, closePool } from './harness'
import { call, userWithToken, seedScope, UNKNOWN_UUID } from './scope-helpers'

// Acceptance suite of version socle-groupes-perimetres: scopes (périmètres).
describe('Scopes', () => {
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

  describe('GET /scopes', () => {
    it('[rule-foundation-scopes-admin-screen] [rule-foundation-scope-definition] an admin lists all scopes sorted by code with total', async () => {
      await seedScope('site-b', 'Site B')
      await seedScope('creche-a', 'Creche A')
      await seedScope('site-a', 'Site A')
      const res = await call('GET', '/scopes', admin.token)
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(3)
      expect(res.body.scopes.map((s: any) => s.code)).toEqual(['creche-a', 'site-a', 'site-b'])
      expect(Object.keys(res.body.scopes[0]).sort()).toEqual(['code', 'id', 'name'])
      expect(res.body.scopes[0]).toMatchObject({ code: 'creche-a', name: 'Creche A' })
      expect(res.body.scopes[0].id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('[rule-foundation-scopes-admin-screen] an admin sees every scope even when belonging to no group', async () => {
      await seedScope('s1')
      await seedScope('s2')
      const res = await call('GET', '/scopes', admin.token)
      expect(res.body.total).toBe(2)
    })

    it('[rule-foundation-list-pagination] from and size paginate the list and total stays the full count', async () => {
      for (const c of ['a1', 'a2', 'a3', 'a4', 'a5']) await seedScope(c)
      const page = await call('GET', '/scopes?from=2&size=2', admin.token)
      expect(page.status).toBe(200)
      expect(page.body.scopes.map((s: any) => s.code)).toEqual(['a3', 'a4'])
      expect(page.body.total).toBe(5)
      const beyond = await call('GET', '/scopes?from=10&size=2', admin.token)
      expect(beyond.status).toBe(200)
      expect(beyond.body.scopes).toEqual([])
      expect(beyond.body.total).toBe(5)
    })

    it('[rule-foundation-list-pagination] default size is 10 and size 100 is accepted', async () => {
      for (let i = 0; i < 12; i++) await seedScope(`code-${String(i).padStart(2, '0')}`)
      const def = await call('GET', '/scopes', admin.token)
      expect(def.body.scopes).toHaveLength(10)
      expect(def.body.total).toBe(12)
      const max = await call('GET', '/scopes?size=100', admin.token)
      expect(max.status).toBe(200)
      expect(max.body.scopes).toHaveLength(12)
    })

    it.each(['size=0', 'size=101', 'size=-1', 'size=abc', 'from=-1', 'from=abc', 'from=1.5'])(
      '[rule-foundation-list-pagination] query %s answers 400 api.validation.incoming_failed',
      async (query) => {
        const res = await call('GET', `/scopes?${query}`, admin.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      },
    )

    it('[rule-foundation-scopes-admin-screen] an ordinary user gets 403 security.access_denied', async () => {
      await seedScope('s1')
      const res = await call('GET', '/scopes', user.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
    })

    it('[rule-foundation-scopes-admin-screen] an anonymous caller gets 401', async () => {
      const res = await call('GET', '/scopes')
      expect(res.status).toBe(401)
    })
  })

  describe('POST /scopes', () => {
    it('[rule-foundation-scope-definition] an admin creates a scope; name is trimmed and the scope is persisted', async () => {
      const res = await call('POST', '/scopes', admin.token, { code: 'creche-1', name: '  Creche du Parc  ' })
      expect(res.status).toBe(201)
      expect(res.body.scope).toMatchObject({ code: 'creche-1', name: 'Creche du Parc' })
      expect(Object.keys(res.body.scope).sort()).toEqual(['code', 'id', 'name'])
      const rows = await sql('select code, name from base.scopes')
      expect(rows).toEqual([{ code: 'creche-1', name: 'Creche du Parc' }])
    })

    it('[rule-foundation-scope-code-unique] a second scope with the same code answers 409 scopes.code_already_exists', async () => {
      await seedScope('site-1', 'Premier')
      const res = await call('POST', '/scopes', admin.token, { code: 'site-1', name: 'Second' })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('scopes.code_already_exists')
      const rows = await sql('select name from base.scopes')
      expect(rows).toEqual([{ name: 'Premier' }])
    })

    it('[rule-foundation-scope-code-unique] two parallel creations with the same code give one 201 and one 409, never a 500', async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) => call('POST', '/scopes', admin.token, { code: 'race', name: `Course ${i}` })),
      )
      const statuses = results.map((r) => r.status).sort()
      expect(statuses).toEqual([201, 409, 409, 409])
      expect(await sql('select 1 from base.scopes')).toHaveLength(1)
    })

    it('[rule-foundation-scope-code-format] boundary values are accepted: 1-char code, 50-char code, 100-char name, separators', async () => {
      expect((await call('POST', '/scopes', admin.token, { code: 'a', name: 'x' })).status).toBe(201)
      expect((await call('POST', '/scopes', admin.token, { code: '9', name: 'x' })).status).toBe(201)
      expect((await call('POST', '/scopes', admin.token, { code: 'a'.repeat(50), name: 'n'.repeat(100) })).status).toBe(201)
      expect((await call('POST', '/scopes', admin.token, { code: 'site_a-1', name: 'x' })).status).toBe(201)
    })

    it.each([
      ['uppercase', { code: 'Site', name: 'x' }],
      ['space', { code: 'site 1', name: 'x' }],
      ['accent', { code: 'créche', name: 'x' }],
      ['leading dash', { code: '-site', name: 'x' }],
      ['leading underscore', { code: '_site', name: 'x' }],
      ['dot', { code: 'site.1', name: 'x' }],
      ['empty code', { code: '', name: 'x' }],
      ['51-char code', { code: 'a'.repeat(51), name: 'x' }],
      ['empty name', { code: 'ok', name: '' }],
      ['blank name', { code: 'ok', name: '   ' }],
      ['101-char name', { code: 'ok', name: 'n'.repeat(101) }],
      ['missing name', { code: 'ok' }],
      ['missing code', { name: 'x' }],
      ['empty body', {}],
      ['code not a string', { code: 12, name: 'x' }],
      ['name not a string', { code: 'ok', name: 12 }],
    ])('[rule-foundation-scope-code-format] %s answers 400 and creates nothing', async (_label, body) => {
      const res = await call('POST', '/scopes', admin.token, body)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await sql('select 1 from base.scopes')).toHaveLength(0)
    })

    it('[rule-foundation-scopes-admin-screen] an ordinary user gets 403 and nothing is created', async () => {
      const res = await call('POST', '/scopes', user.token, { code: 'site', name: 'Site' })
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
      expect(await sql('select 1 from base.scopes')).toHaveLength(0)
    })

    it('[rule-foundation-scopes-admin-screen] an anonymous caller gets 401 and nothing is created', async () => {
      const res = await call('POST', '/scopes', undefined, { code: 'site', name: 'Site' })
      expect(res.status).toBe(401)
      expect(await sql('select 1 from base.scopes')).toHaveLength(0)
    })
  })

  describe('PATCH /scopes/:id', () => {
    it('[rule-foundation-scopes-admin-screen] an admin renames a scope; code and id are unchanged', async () => {
      const s = await seedScope('site-1', 'Ancien')
      const res = await call('PATCH', `/scopes/${s.id}`, admin.token, { name: '  Nouveau nom ' })
      expect(res.status).toBe(200)
      expect(res.body.scope).toEqual({ id: s.id, code: 'site-1', name: 'Nouveau nom' })
      expect(await sql('select code, name from base.scopes')).toEqual([{ code: 'site-1', name: 'Nouveau nom' }])
    })

    it('[rule-foundation-scope-code-immutable] a body containing code answers 400 and the scope is unchanged', async () => {
      const s = await seedScope('site-1', 'Nom')
      const res = await call('PATCH', `/scopes/${s.id}`, admin.token, { name: 'Autre', code: 'site-2' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
      expect(await sql('select code, name from base.scopes')).toEqual([{ code: 'site-1', name: 'Nom' }])
    })

    it.each([[{ code: 'site-2' }], [{ name: 'Ok', extra: 1 }], [{ id: '00000000-0000-4000-8000-000000000001' }]])(
      '[rule-foundation-scope-code-immutable] body %j (unknown key) answers 400 and changes nothing',
      async (body) => {
        const s = await seedScope('site-1', 'Nom')
        const res = await call('PATCH', `/scopes/${s.id}`, admin.token, body)
        expect(res.status).toBe(400)
        expect(await sql('select id, code, name from base.scopes')).toEqual([{ id: s.id, code: 'site-1', name: 'Nom' }])
      },
    )

    it.each([[{ name: '' }], [{ name: '   ' }], [{ name: 'n'.repeat(101) }], [{ name: 5 }], [{}]])(
      '[rule-foundation-scope-definition] invalid name body %j answers 400',
      async (body) => {
        const s = await seedScope('site-1', 'Nom')
        const res = await call('PATCH', `/scopes/${s.id}`, admin.token, body)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
        expect(await sql('select name from base.scopes')).toEqual([{ name: 'Nom' }])
      },
    )

    it('[rule-foundation-scope-definition] a 100-char name is accepted', async () => {
      const s = await seedScope('site-1')
      const res = await call('PATCH', `/scopes/${s.id}`, admin.token, { name: 'n'.repeat(100) })
      expect(res.status).toBe(200)
    })

    it('[rule-foundation-scopes-admin-screen] a malformed id answers 400', async () => {
      const res = await call('PATCH', '/scopes/not-a-uuid', admin.token, { name: 'x' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-scopes-admin-screen] an unknown id answers 404 repository.not_found', async () => {
      const res = await call('PATCH', `/scopes/${UNKNOWN_UUID}`, admin.token, { name: 'x' })
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('repository.not_found')
    })

    it('[rule-foundation-scopes-admin-screen] an ordinary user gets 403 and the scope is unchanged', async () => {
      const s = await seedScope('site-1', 'Nom')
      const res = await call('PATCH', `/scopes/${s.id}`, user.token, { name: 'Pirate' })
      expect(res.status).toBe(403)
      expect(await sql('select name from base.scopes')).toEqual([{ name: 'Nom' }])
    })

    it('[rule-foundation-scopes-admin-screen] an anonymous caller gets 401', async () => {
      const s = await seedScope('site-1', 'Nom')
      const res = await call('PATCH', `/scopes/${s.id}`, undefined, { name: 'Pirate' })
      expect(res.status).toBe(401)
    })
  })

  describe('no deletion', () => {
    it('[rule-foundation-scope-no-delete] DELETE /scopes/:id does not exist and the scope is kept', async () => {
      const s = await seedScope('site-1')
      for (const token of [admin.token, user.token, undefined]) {
        const res = await call('DELETE', `/scopes/${s.id}`, token)
        expect([401, 403, 404]).toContain(res.status)
      }
      const adminRes = await call('DELETE', `/scopes/${s.id}`, admin.token)
      expect(adminRes.status).toBe(404)
      expect(await sql('select 1 from base.scopes')).toHaveLength(1)
    })

    it('[rule-foundation-scope-no-delete] DELETE /scopes (collection) does not exist', async () => {
      await seedScope('site-1')
      const res = await call('DELETE', '/scopes', admin.token)
      expect(res.status).toBe(404)
      expect(await sql('select 1 from base.scopes')).toHaveLength(1)
    })
  })

  describe('multi-company absence', () => {
    it('[rule-foundation-no-multi-company] scope responses carry no company/tenant field', async () => {
      const created = await call('POST', '/scopes', admin.token, { code: 'site-1', name: 'Site' })
      const listed = await call('GET', '/scopes', admin.token)
      for (const obj of [created.body.scope, listed.body.scopes[0]]) {
        expect(Object.keys(obj).sort()).toEqual(['code', 'id', 'name'])
      }
      expect(Object.keys(listed.body).sort()).toEqual(['scopes', 'total'])
    })

    it('[rule-foundation-no-multi-company] a company field sent on creation is not accepted as a notion of the API', async () => {
      const res = await call('POST', '/scopes', admin.token, { code: 'site-2', name: 'Site', companyId: UNKNOWN_UUID })
      if (res.status === 201) expect(JSON.stringify(res.body)).not.toMatch(/company|tenant|entreprise/i)
      else expect(res.status).toBe(400)
    })
  })
})
