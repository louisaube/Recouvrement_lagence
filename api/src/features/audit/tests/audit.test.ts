import { call, closePool, createUser, login, resetData, sql } from '../../../platform/testing/helpers'

const ACTOR_A = '11111111-1111-4111-8111-111111111111'
const ACTOR_B = '22222222-2222-4222-8222-222222222222'

interface Seed {
  at?: string
  actorId?: string
  email?: string
  action?: string
  type?: string
  objectId?: string
  scope?: string | null
}

describe('audit journal routes', () => {
  let admin: string
  let user: string
  let counter = 0

  const send = (path: string, token: string | undefined, method = 'GET') =>
    call(path, { method, headers: token ? { authorization: `Bearer ${token}` } : {} })
  // `null` = anonymous call (an explicit `undefined` would trigger the default parameter)
  const list = (query = '', token: string | null = admin) => send(`/audit-logs${query}`, token ?? undefined)
  const seed = async (e: Seed = {}) => {
    counter += 1
    return (
      await sql<{ id: string }>(
        `insert into base.audit_logs (occurred_at, actor_id, actor_email, action, object_type, object_id, scope_code, summary)
         values ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          e.at ?? '2026-01-01T10:00:00.000Z',
          e.actorId ?? ACTOR_A,
          e.email ?? 'a@example.com',
          e.action ?? 'groups:update',
          e.type ?? 'Groupe',
          e.objectId ?? `o${counter}`,
          e.scope ?? null,
          `Résumé ${counter}`,
        ],
      )
    )[0].id
  }
  const objectIds = async (query: string) => ((await (await list(query)).json()).entries as any[]).map((e) => e.objectId)

  beforeEach(async () => {
    await resetData()
    await createUser({ email: 'admin@example.com', role: 'admin' })
    await createUser({ email: 'user@example.com', role: 'user' })
    admin = await login('admin@example.com')
    user = await login('user@example.com')
  })
  afterAll(closePool)

  describe('GET /audit-logs', () => {
    it('[rule-foundation-audit-trace-content] returns the fields of an entry, the date in UTC to the millisecond', async () => {
      const id = await seed({ at: '2026-03-05T08:09:10.123Z', action: 'scopes:create', type: 'Périmètre', scope: 'site-1', objectId: 'REF/1' })
      const body = await (await list()).json()
      expect(body.total).toBe(1)
      expect(body.entries[0]).toEqual({
        id,
        occurredAt: '2026-03-05T08:09:10.123Z',
        actor: { id: ACTOR_A, email: 'a@example.com' },
        action: 'scopes:create',
        objectType: 'Périmètre',
        objectId: 'REF/1',
        scope: 'site-1',
        summary: 'Résumé 1',
      })
    })

    it('[rule-foundation-audit-newest-first] newest first, then id descending, stable from one page to the next', async () => {
      const ids: string[] = []
      for (let i = 0; i < 4; i++) ids.push(await seed({ at: '2026-02-01T00:00:00.000Z' }))
      await seed({ at: '2026-03-01T00:00:00.000Z', objectId: 'newest' })
      const all = (await (await list('?size=100')).json()).entries.map((e: any) => e.id)
      expect(all.slice(1)).toEqual([...ids].sort().reverse())
      const paged = [0, 2, 4].flatMap(async (from) => (await (await list(`?from=${from}&size=2`)).json()).entries.map((e: any) => e.id))
      expect((await Promise.all(paged)).flat()).toEqual(all)
      expect((await objectIds('?size=1'))[0]).toBe('newest')
    })

    it('[rule-foundation-audit-filters] [rule-foundation-audit-filters-combine] exact filters combined with AND; total counts the matches', async () => {
      await seed({ at: '2026-01-01T00:00:00.000Z', actorId: ACTOR_A, action: 'groups:update', objectId: 'e1' })
      await seed({ at: '2026-01-02T00:00:00.000Z', actorId: ACTOR_B, action: 'groups:create', objectId: 'e2' })
      await seed({ at: '2026-01-03T00:00:00.000Z', actorId: ACTOR_A, action: 'scopes:create', type: 'Périmètre', scope: 'site-1', objectId: 'e3' })
      expect(await objectIds(`?actorId=${ACTOR_A}`)).toEqual(['e3', 'e1'])
      expect(await objectIds('?action=groups:upd')).toEqual([])
      expect(await objectIds(`?objectType=${encodeURIComponent('Périmètre')}&scope=site-1`)).toEqual(['e3'])
      expect(await objectIds('?scope=site')).toEqual([])
      expect(await objectIds(`?actorId=${ACTOR_A}&action=groups:create`)).toEqual([])
      const paged = await (await list(`?actorId=${ACTOR_A}&size=1&from=1`)).json()
      expect(paged.entries.map((e: any) => e.objectId)).toEqual(['e1'])
      expect(paged.total).toBe(2)
    })

    it('[rule-foundation-audit-ms-precision] period bounds are included to the millisecond, a zone offset is understood', async () => {
      await seed({ at: '2026-04-10T23:59:59.999Z', objectId: 'last-ms' })
      await seed({ at: '2026-04-11T00:00:00.000Z', objectId: 'first-ms' })
      await seed({ at: '2026-04-11T00:00:00.001Z', objectId: 'after' })
      const q = (from: string, to: string) => `?occurredFrom=${encodeURIComponent(from)}&occurredTo=${encodeURIComponent(to)}`
      expect(await objectIds(q('2026-04-11T00:00:00.000Z', '2026-04-11T23:59:59.999Z'))).toEqual(['after', 'first-ms'])
      expect(await objectIds(q('2026-04-11T00:00:00.000Z', '2026-04-11T00:00:00.000Z'))).toEqual(['first-ms'])
      expect(await objectIds(q('2026-04-11T02:00:00+02:00', '2026-04-11T02:00:00.000+02:00'))).toEqual(['first-ms'])
      expect(await objectIds(`?occurredTo=${encodeURIComponent('2026-04-10T23:59:59.999Z')}`)).toEqual(['last-ms'])
    })

    it.each([
      ['size=0'],
      ['size=101'],
      ['from=2147483648'],
      ['from=-1'],
      ['actorId=abc'],
      ['action='],
      [`scope=${'s'.repeat(51)}`],
      ['occurredFrom=2026-01-01T00:00:00'],
      ['occurredFrom=2026-01-01'],
      [`occurredFrom=${encodeURIComponent('2026-02-30T00:00:00Z')}`],
      [`occurredFrom=${encodeURIComponent('0999-01-01T00:00:00Z')}`],
      [`occurredFrom=${encodeURIComponent('2026-02-02T00:00:00Z')}&occurredTo=${encodeURIComponent('2026-02-01T00:00:00Z')}`],
      ['action=a&action=b'],
      ['scope=a%00b'],
    ])('[rule-foundation-audit-filters] %s answers 400', async (query) => {
      const res = await list(`?${query}`)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-audit-filters] extreme but valid zone offsets and dates never give a server error', async () => {
      for (const at of ['9999-12-31T23:59:59-23:59', '1000-01-01T00:00:00+23:59', '2026-01-01T00:00:00.123456789Z']) {
        expect((await list(`?occurredFrom=${encodeURIComponent(at)}`)).status).toBe(200)
      }
    })

    it('[rule-foundation-audit-admin-only] 403 for a user (before the validation), 401 for a visitor and an invalid token', async () => {
      await seed()
      const denied = await list('?size=0', user)
      expect(denied.status).toBe(403)
      expect((await denied.json()).code).toBe('security.access_denied')
      expect((await list('', null)).status).toBe(401)
      expect((await list('', 'not-a-token')).status).toBe(401)
    })
  })

  describe('GET /audit-logs/filters', () => {
    it('[rule-foundation-audit-filter-options-from-journal] an empty journal gives four empty lists, whatever the accounts and scopes', async () => {
      await sql("insert into base.scopes (code, name) values ('jamais', 'Jamais')")
      const res = await send('/audit-logs/filters', admin)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ actors: [], actions: [], objectTypes: [], scopes: [] })
    })

    it('[rule-foundation-audit-filter-options-from-journal] distinct sorted values, one author with the latest e-mail, no null scope', async () => {
      await seed({ at: '2026-01-01T00:00:00.000Z', actorId: ACTOR_A, email: 'ancien@example.com', action: 'scopes:update', type: 'Périmètre', scope: 'site-2' })
      await seed({ at: '2026-02-01T00:00:00.000Z', actorId: ACTOR_A, email: 'Zoe@example.com', action: 'groups:create', type: 'Groupe' })
      await seed({ at: '2026-02-02T00:00:00.000Z', actorId: ACTOR_B, email: 'anna@example.com', action: 'groups:create', type: 'Groupe', scope: 'site-1' })
      const body = await (await send('/audit-logs/filters?size=0&action=zzz', admin)).json()
      expect(body.actors).toEqual([
        { id: ACTOR_B, email: 'anna@example.com' },
        { id: ACTOR_A, email: 'Zoe@example.com' },
      ])
      expect(body.actions).toEqual(['groups:create', 'scopes:update'])
      expect(body.objectTypes).toEqual(['Groupe', 'Périmètre'])
      expect(body.scopes).toEqual(['site-1', 'site-2'])
    })

    it('[rule-foundation-audit-filter-options-from-journal] each list is bounded to 1000 elements', async () => {
      await sql(
        `insert into base.audit_logs (actor_id, actor_email, action, object_type, object_id, scope_code, summary)
         select gen_random_uuid(), 'u' || lpad(n::text, 5, '0') || '@example.com', 'feat:act' || lpad(n::text, 5, '0'),
                'Type' || lpad(n::text, 5, '0'), 'o' || n, 'sc' || lpad(n::text, 5, '0'), 'Résumé'
         from generate_series(1, 1010) n`,
      )
      const body = await (await send('/audit-logs/filters', admin)).json()
      for (const key of ['actors', 'actions', 'objectTypes', 'scopes']) expect(body[key]).toHaveLength(1000)
    })

    it('[rule-foundation-audit-admin-only] 403 for a user, 401 for a visitor', async () => {
      expect((await send('/audit-logs/filters', user)).status).toBe(403)
      expect((await send('/audit-logs/filters', undefined)).status).toBe(401)
    })
  })

  describe('immutability', () => {
    it.each(['/audit-logs', '/audit-logs/filters', '/audit-logs/11111111-1111-4111-8111-111111111111'])(
      '[rule-foundation-audit-immutable] POST, PUT, PATCH and DELETE on %s are 404 for an administrator and the journal is unchanged',
      async (path) => {
        await seed({ objectId: 'intact' })
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const res = await send(path, admin, method)
          expect(res.status).toBe(404)
          expect((await res.json()).code).toBe('api.route_not_found')
          expect([401, 404]).toContain((await send(path, undefined, method)).status)
        }
        expect(await sql('select object_id from base.audit_logs')).toEqual([{ object_id: 'intact' }])
      },
    )

    it('[rule-foundation-audit-db-append-only] the database refuses UPDATE and DELETE, in a transaction too (42501)', async () => {
      const id = await seed({ objectId: 'kept' })
      await expect(sql("update base.audit_logs set summary = 'x' where id = $1", [id])).rejects.toMatchObject({ code: '42501' })
      await expect(sql('delete from base.audit_logs where id = $1', [id])).rejects.toMatchObject({ code: '42501' })
      await expect(sql('begin; delete from base.audit_logs; commit')).rejects.toMatchObject({ code: '42501' })
      expect(await sql('select object_id from base.audit_logs')).toEqual([{ object_id: 'kept' }])
    })

    it('[rule-foundation-audit-survives-author-deletion] deleting the author account changes no entry, list or option', async () => {
      const author = await createUser({ email: 'auteur@example.com', role: 'admin' })
      await seed({ actorId: author.id, email: 'auteur@example.com', objectId: 'trace' })
      const before = (await (await list()).json()).entries
      await sql('delete from base.credentials where user_id = $1', [author.id])
      await sql('delete from base.users where id = $1', [author.id])
      expect((await (await list(`?actorId=${author.id}`)).json()).entries).toEqual(before)
      expect((await (await send('/audit-logs/filters', admin)).json()).actors).toEqual([{ id: author.id, email: 'auteur@example.com' }])
    })
  })
})
