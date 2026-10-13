import { call, closePool, createUser, login, resetData, sql } from '../../../platform/testing/helpers'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'

describe('scopes routes', () => {
  let admin: string
  let user: string
  const send = (path: string, token: string | undefined, method = 'GET', body?: unknown) =>
    call(path, { method, body, headers: token ? { authorization: `Bearer ${token}` } : {} })
  const seed = async (code: string, name = `Scope ${code}`) =>
    (await sql<{ id: string }>('insert into base.scopes (code, name) values ($1, $2) returning id', [code, name]))[0]

  beforeEach(async () => {
    await resetData()
    await createUser({ email: 'admin@example.com', role: 'admin' })
    await createUser({ email: 'user@example.com', role: 'user' })
    admin = await login('admin@example.com')
    user = await login('user@example.com')
  })
  afterAll(closePool)

  describe('GET /scopes', () => {
    it('[rule-foundation-scope-definition] lists the scopes sorted by code, with the total', async () => {
      await seed('b-site')
      await seed('a_site')
      await seed('a-site')
      const res = await send('/scopes', admin)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(3)
      expect(body.scopes.map((s: any) => s.code)).toEqual(['a-site', 'a_site', 'b-site'])
      expect(Object.keys(body.scopes[0]).sort()).toEqual(['code', 'id', 'name'])
    })

    it('[rule-foundation-list-pagination] pages without gap, a page beyond the total is empty', async () => {
      for (const code of ['c1', 'c2', 'c3', 'c4', 'c5']) await seed(code)
      const page = await (await send('/scopes?from=2&size=2', admin)).json()
      expect(page.scopes.map((s: any) => s.code)).toEqual(['c3', 'c4'])
      expect(page.total).toBe(5)
      const beyond = await (await send('/scopes?from=50', admin)).json()
      expect(beyond).toEqual({ scopes: [], total: 5 })
    })

    it.each(['size=0', 'size=101', 'size=-1', 'size=', 'size=1.5', 'size=1e1', 'from=-1', 'from=', 'from=2147483648', 'from=x'])(
      '[rule-foundation-list-pagination] query %s is refused with 400',
      async (query) => {
        const res = await send(`/scopes?${query}`, admin)
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('api.validation.incoming_failed')
      },
    )

    it('[rule-foundation-list-pagination] a repeated parameter is refused with 400', async () => {
      expect((await send('/scopes?size=1&size=2', admin)).status).toBe(400)
    })

    it('[rule-foundation-scopes-admin-screen] 403 for a user, 401 for a visitor', async () => {
      expect((await send('/scopes', user)).status).toBe(403)
      expect((await send('/scopes', undefined)).status).toBe(401)
    })
  })

  describe('POST /scopes', () => {
    it('[rule-foundation-scope-definition] creates a scope with a trimmed name and returns exactly { id, code, name }', async () => {
      const res = await send('/scopes', admin, 'POST', { code: 'creche-1', name: '  Crèche du Parc ' })
      expect(res.status).toBe(201)
      const { scope } = await res.json()
      expect(Object.keys(scope).sort()).toEqual(['code', 'id', 'name'])
      expect(scope).toMatchObject({ code: 'creche-1', name: 'Crèche du Parc' })
      expect(await sql('select code, name from base.scopes')).toEqual([{ code: 'creche-1', name: 'Crèche du Parc' }])
    })

    it('[rule-foundation-scope-code-unique] a used code is 409 scopes.code_already_exists', async () => {
      await seed('site')
      const res = await send('/scopes', admin, 'POST', { code: 'site', name: 'Autre' })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('scopes.code_already_exists')
    })

    it('[rule-foundation-scope-code-unique] four simultaneous creations give one 201 and three 409', async () => {
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) => send('/scopes', admin, 'POST', { code: 'race', name: `Course ${i}` })),
      )
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
    })

    it.each([
      ['uppercase', { code: 'Site', name: 'x' }],
      ['accent', { code: 'créche', name: 'x' }],
      ['leading separator', { code: '-site', name: 'x' }],
      ['dot', { code: 'a.b', name: 'x' }],
      ['empty code', { code: '', name: 'x' }],
      ['51 characters', { code: 'a'.repeat(51), name: 'x' }],
      ['blank name', { code: 'ok', name: '   ' }],
      ['101-character name', { code: 'ok', name: 'n'.repeat(101) }],
      ['missing name', { code: 'ok' }],
      ['wrong type', { code: 5, name: 'x' }],
    ])('[rule-foundation-scope-code-format] %s is refused with 400 and nothing is created', async (_label, body) => {
      const res = await send('/scopes', admin, 'POST', body)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('api.validation.incoming_failed')
      expect(await sql('select 1 from base.scopes')).toHaveLength(0)
    })

    it('[rule-foundation-scope-code-format] the bounds are accepted: 1 and 50 characters, 100-character name', async () => {
      expect((await send('/scopes', admin, 'POST', { code: '9', name: 'x' })).status).toBe(201)
      expect((await send('/scopes', admin, 'POST', { code: 'a'.repeat(50), name: 'n'.repeat(100) })).status).toBe(201)
    })

    it('[rule-foundation-scopes-admin-screen] 403 for a user, 401 for a visitor, nothing created', async () => {
      expect((await send('/scopes', user, 'POST', { code: 'x', name: 'x' })).status).toBe(403)
      expect((await send('/scopes', undefined, 'POST', { code: 'x', name: 'x' })).status).toBe(401)
      expect(await sql('select 1 from base.scopes')).toHaveLength(0)
    })
  })

  describe('PATCH /scopes/:id', () => {
    it('[rule-foundation-scope-code-immutable] renames: the id and the code do not change', async () => {
      const { id } = await seed('site-1', 'Ancien')
      const res = await send(`/scopes/${id}`, admin, 'PATCH', { name: ' Nouveau ' })
      expect(res.status).toBe(200)
      expect((await res.json()).scope).toEqual({ id, code: 'site-1', name: 'Nouveau' })
    })

    it.each([[{ name: 'x', code: 'other' }], [{ code: 'other' }], [{ name: 'x', id: UNKNOWN }], [{}]])(
      '[rule-foundation-scope-code-immutable] body %j is refused with 400 and nothing changes',
      async (body) => {
        const { id } = await seed('site-1', 'Nom')
        const res = await send(`/scopes/${id}`, admin, 'PATCH', body)
        expect(res.status).toBe(400)
        expect(await sql('select code, name from base.scopes')).toEqual([{ code: 'site-1', name: 'Nom' }])
      },
    )

    it('[rule-foundation-scopes-admin-screen] malformed id is 400, unknown id is 404 repository.not_found', async () => {
      expect((await send('/scopes/not-a-uuid', admin, 'PATCH', { name: 'x' })).status).toBe(400)
      const res = await send(`/scopes/${UNKNOWN}`, admin, 'PATCH', { name: 'x' })
      expect(res.status).toBe(404)
      expect((await res.json()).code).toBe('repository.not_found')
    })

    it('[rule-foundation-scopes-admin-screen] 403 for a user, 401 for a visitor', async () => {
      const { id } = await seed('site-1', 'Nom')
      expect((await send(`/scopes/${id}`, user, 'PATCH', { name: 'x' })).status).toBe(403)
      expect((await send(`/scopes/${id}`, undefined, 'PATCH', { name: 'x' })).status).toBe(401)
      expect(await sql('select name from base.scopes')).toEqual([{ name: 'Nom' }])
    })
  })

  it('[rule-foundation-scope-no-delete] DELETE /scopes/:id and DELETE /scopes answer 404 and keep the scope', async () => {
    const { id } = await seed('site-1')
    expect((await send(`/scopes/${id}`, admin, 'DELETE')).status).toBe(404)
    expect((await send('/scopes', admin, 'DELETE')).status).toBe(404)
    expect(await sql('select 1 from base.scopes')).toHaveLength(1)
  })

  it('[rule-foundation-scope-no-delete] the database refuses to delete a scope referenced by a group', async () => {
    const { id } = await seed('site-1')
    const [group] = await sql<{ id: string }>("insert into base.groups (name) values ('G') returning id")
    await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2)', [group.id, id])
    await expect(sql('delete from base.scopes where id = $1', [id])).rejects.toThrow()
  })
})
