import { sql, resetData, closePool, createUser } from './harness'
import { call, userWithToken, PASSWORD } from './scope-helpers'
import { seedEntry, countEntries, allEntries, qs, ACTOR_A, ACTOR_B } from './audit-helpers'

// Acceptance suite of version socle-journal-audit: reading the journal (GET /audit-logs, GET /audit-logs/filters)
// and its immutability.
describe('Audit journal', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>

  // `null` = anonymous call (an explicit `undefined` would trigger the default parameter and send the admin token)
  const list = (query = '', token: string | null = admin.token) => call('GET', `/audit-logs${query}`, token ?? undefined)

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
  })
  afterAll(async () => {
    await closePool()
  })

  describe('GET /audit-logs', () => {
    it('[rule-foundation-audit-trace-content] returns every field of an entry: author, date, action, object type and id, scope, summary', async () => {
      const id = await seedEntry({
        occurredAt: '2026-03-05T08:09:10.123Z',
        actorId: ACTOR_A,
        actorEmail: 'auteur-a@example.com',
        action: 'scopes:create',
        objectType: 'Périmètre',
        objectId: 'abc-123',
        scope: 'site-1',
        summary: 'Création du périmètre « Site 1 » (site-1)',
      })
      const res = await list()
      expect(res.status).toBe(200)
      expect(Object.keys(res.body).sort()).toEqual(['entries', 'total'])
      expect(res.body.total).toBe(1)
      const e = res.body.entries[0]
      expect(Object.keys(e).sort()).toEqual(['action', 'actor', 'id', 'objectId', 'objectType', 'occurredAt', 'scope', 'summary'])
      expect(e).toEqual({
        id,
        occurredAt: '2026-03-05T08:09:10.123Z',
        actor: { id: ACTOR_A, email: 'auteur-a@example.com' },
        action: 'scopes:create',
        objectType: 'Périmètre',
        objectId: 'abc-123',
        scope: 'site-1',
        summary: 'Création du périmètre « Site 1 » (site-1)',
      })
      expect(Object.keys(e.actor).sort()).toEqual(['email', 'id'])
    })

    it('[rule-foundation-audit-trace-content] an entry without scope has scope null; objectId need not be a UUID', async () => {
      await seedEntry({ scope: null, objectId: 'REF/2026/0001' })
      const e = (await list()).body.entries[0]
      expect(e.scope).toBeNull()
      expect(e.objectId).toBe('REF/2026/0001')
    })

    it('[rule-foundation-audit-newest-first] entries are sorted from the most recent to the oldest', async () => {
      await seedEntry({ occurredAt: '2026-01-02T00:00:00.000Z', objectId: 'mid' })
      await seedEntry({ occurredAt: '2026-01-03T00:00:00.000Z', objectId: 'new' })
      await seedEntry({ occurredAt: '2026-01-01T00:00:00.000Z', objectId: 'old' })
      const res = await list()
      expect(res.body.entries.map((e: any) => e.objectId)).toEqual(['new', 'mid', 'old'])
    })

    it('[rule-foundation-audit-newest-first] entries with the same date are ordered by id descending, stable across pages', async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) ids.push(await seedEntry({ occurredAt: '2026-02-01T00:00:00.000Z' }))
      const expected = [...ids].sort().reverse()
      const all = await list('?size=100')
      expect(all.body.entries.map((e: any) => e.id)).toEqual(expected)
      const p1 = await list('?from=0&size=2')
      const p2 = await list('?from=2&size=2')
      const p3 = await list('?from=4&size=2')
      expect([...p1.body.entries, ...p2.body.entries, ...p3.body.entries].map((e: any) => e.id)).toEqual(expected)
    })

    it('[rule-foundation-audit-newest-first] from and size paginate; total is the full count; default size is 10; size 1 and 100 are accepted', async () => {
      for (let i = 1; i <= 12; i++) {
        await seedEntry({ occurredAt: `2026-01-${String(i).padStart(2, '0')}T00:00:00.000Z`, objectId: `o${i}` })
      }
      const def = await list()
      expect(def.status).toBe(200)
      expect(def.body.entries).toHaveLength(10)
      expect(def.body.total).toBe(12)
      const page = await list('?from=10&size=5')
      expect(page.body.entries.map((e: any) => e.objectId)).toEqual(['o2', 'o1'])
      expect(page.body.total).toBe(12)
      expect((await list('?size=1')).body.entries).toHaveLength(1)
      expect((await list('?size=100')).body.entries).toHaveLength(12)
      const beyond = await list('?from=50')
      expect(beyond.status).toBe(200)
      expect(beyond.body).toEqual({ entries: [], total: 12 })
    })

    it('[rule-foundation-audit-trace-content] an empty journal answers 200 with no entry', async () => {
      const res = await list()
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ entries: [], total: 0 })
    })

    it('[rule-foundation-audit-survives-author-deletion] entries of an author whose account does not exist keep their e-mail and stay listed and filterable', async () => {
      const gone = await createUser({ email: 'parti@example.com', password: PASSWORD, role: 'user' })
      await seedEntry({ actorId: gone.id, actorEmail: 'parti@example.com', objectId: 'kept' })
      await sql('delete from base.credentials where user_id = $1', [gone.id])
      await sql('delete from base.group_users where user_id = $1', [gone.id])
      await sql('delete from base.users where id = $1', [gone.id])
      expect(await sql('select 1 from base.users where id = $1', [gone.id])).toHaveLength(0)

      const res = await list(qs({ actorId: gone.id }))
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
      expect(res.body.entries[0].actor).toEqual({ id: gone.id, email: 'parti@example.com' })
      expect(res.body.entries[0].objectId).toBe('kept')
      expect(await countEntries()).toBe(1)
    })

    describe('filters', () => {
      beforeEach(async () => {
        await seedEntry({ occurredAt: '2026-01-01T00:00:00.000Z', actorId: ACTOR_A, actorEmail: 'a@example.com', action: 'groups:update', objectType: 'Groupe', scope: null, objectId: 'e1' })
        await seedEntry({ occurredAt: '2026-01-02T00:00:00.000Z', actorId: ACTOR_B, actorEmail: 'b@example.com', action: 'groups:create', objectType: 'Groupe', scope: null, objectId: 'e2' })
        await seedEntry({ occurredAt: '2026-01-03T00:00:00.000Z', actorId: ACTOR_A, actorEmail: 'a@example.com', action: 'scopes:create', objectType: 'Périmètre', scope: 'site-1', objectId: 'e3' })
        await seedEntry({ occurredAt: '2026-01-04T00:00:00.000Z', actorId: ACTOR_B, actorEmail: 'b@example.com', action: 'scopes:update', objectType: 'Périmètre', scope: 'site-2', objectId: 'e4' })
      })
      const ids = (res: any) => res.body.entries.map((e: any) => e.objectId)

      it('[rule-foundation-audit-filters] filters by author (actorId)', async () => {
        const res = await list(qs({ actorId: ACTOR_A }))
        expect(ids(res)).toEqual(['e3', 'e1'])
        expect(res.body.total).toBe(2)
      })

      it('[rule-foundation-audit-filters] filters by action with exact equality', async () => {
        expect(ids(await list(qs({ action: 'groups:update' })))).toEqual(['e1'])
        const prefix = await list(qs({ action: 'groups:upd' }))
        expect(prefix.status).toBe(200)
        expect(prefix.body).toEqual({ entries: [], total: 0 })
        expect((await list(qs({ action: 'groups' }))).body.total).toBe(0)
        expect((await list(qs({ action: 'GROUPS:UPDATE' }))).body.total).toBe(0)
      })

      it('[rule-foundation-audit-filters] filters by object type with exact equality', async () => {
        expect(ids(await list(qs({ objectType: 'Périmètre' })))).toEqual(['e4', 'e3'])
        expect((await list(qs({ objectType: 'Périm' }))).body.total).toBe(0)
      })

      it('[rule-foundation-audit-filters] filters by scope with exact equality; entries without scope never match', async () => {
        expect(ids(await list(qs({ scope: 'site-1' })))).toEqual(['e3'])
        expect((await list(qs({ scope: 'site' }))).body.total).toBe(0)
      })

      it('[rule-foundation-audit-filters] filters by period, both bounds', async () => {
        const res = await list(qs({ occurredFrom: '2026-01-02T00:00:00.000Z', occurredTo: '2026-01-03T00:00:00.000Z' }))
        expect(ids(res)).toEqual(['e3', 'e2'])
        expect(res.body.total).toBe(2)
      })

      it('[rule-foundation-audit-filters] occurredFrom alone means since that instant; occurredTo alone means until that instant', async () => {
        expect(ids(await list(qs({ occurredFrom: '2026-01-03T00:00:00.000Z' })))).toEqual(['e4', 'e3'])
        expect(ids(await list(qs({ occurredTo: '2026-01-02T00:00:00.000Z' })))).toEqual(['e2', 'e1'])
      })

      it('[rule-foundation-audit-filters-combine] active filters combine with AND, and total counts the matching entries', async () => {
        const res = await list(qs({ actorId: ACTOR_A, objectType: 'Périmètre', scope: 'site-1', action: 'scopes:create', occurredFrom: '2026-01-01T00:00:00.000Z' }))
        expect(ids(res)).toEqual(['e3'])
        expect(res.body.total).toBe(1)
        const none = await list(qs({ actorId: ACTOR_A, action: 'groups:create' }))
        expect(none.status).toBe(200)
        expect(none.body).toEqual({ entries: [], total: 0 })
        const paged = await list(qs({ objectType: 'Groupe', size: 1, from: 1 }))
        expect(ids(paged)).toEqual(['e1'])
        expect(paged.body.total).toBe(2)
      })

      it('[rule-foundation-audit-filters-combine] an absent filter is not applied', async () => {
        const res = await list()
        expect(res.body.total).toBe(4)
      })

      it('[rule-foundation-audit-ms-precision] period bounds are inclusive to the millisecond', async () => {
        await resetData()
        admin = await userWithToken('admin@example.com', 'admin')
        await seedEntry({ occurredAt: '2026-04-10T23:59:59.998Z', objectId: 'before' })
        await seedEntry({ occurredAt: '2026-04-10T23:59:59.999Z', objectId: 'last-ms' })
        await seedEntry({ occurredAt: '2026-04-11T00:00:00.000Z', objectId: 'first-ms' })
        await seedEntry({ occurredAt: '2026-04-11T00:00:00.001Z', objectId: 'after' })
        const day = await list(qs({ occurredFrom: '2026-04-11T00:00:00.000Z', occurredTo: '2026-04-11T23:59:59.999Z' }))
        expect(ids(day)).toEqual(['after', 'first-ms'])
        const prev = await list(qs({ occurredTo: '2026-04-10T23:59:59.999Z' }))
        expect(ids(prev)).toEqual(['last-ms', 'before'])
        const exact = await list(qs({ occurredFrom: '2026-04-11T00:00:00.000Z', occurredTo: '2026-04-11T00:00:00.000Z' }))
        expect(ids(exact)).toEqual(['first-ms'])
      })

      it('[rule-foundation-audit-filters] a bound with a UTC offset is understood as the same instant', async () => {
        const res = await list(qs({ occurredFrom: '2026-01-03T01:00:00+01:00', occurredTo: '2026-01-04T01:00:00.000+01:00' }))
        expect(ids(res)).toEqual(['e4', 'e3'])
      })

      it('[rule-foundation-audit-filters] a bound equal on both sides is accepted (occurredFrom = occurredTo)', async () => {
        const res = await list(qs({ occurredFrom: '2026-01-03T00:00:00Z', occurredTo: '2026-01-03T00:00:00Z' }))
        expect(res.status).toBe(200)
        expect(ids(res)).toEqual(['e3'])
      })
    })

    describe('validation', () => {
      it.each([
        ['size=0', 'size=0'],
        ['size=101', 'size=101'],
        ['size=-1', 'size=-1'],
        ['size=abc', 'size=abc'],
        ['size=1.5', 'size=1.5'],
        ['from=-1', 'from=-1'],
        ['from=2147483648', 'from=2147483648'],
        ['from=abc', 'from=abc'],
        ['actorId not a uuid', 'actorId=abc'],
        ['actorId empty', 'actorId='],
        ['empty action', 'action='],
        ['empty objectType', 'objectType='],
        ['empty scope', 'scope='],
        ['101-char action', `action=${'a'.repeat(101)}`],
        ['101-char objectType', `objectType=${'o'.repeat(101)}`],
        ['51-char scope', `scope=${'s'.repeat(51)}`],
        ['occurredFrom invalid', 'occurredFrom=abc'],
        ['occurredTo invalid', 'occurredTo=abc'],
        ['occurredFrom without time zone', `occurredFrom=${encodeURIComponent('2026-01-01T00:00:00')}`],
        ['occurredFrom date only', 'occurredFrom=2026-01-01'],
        ['occurredFrom a nonexistent day', `occurredFrom=${encodeURIComponent('2026-02-30T00:00:00Z')}`],
        ['occurredTo empty', 'occurredTo='],
        ['occurredFrom after occurredTo', `occurredFrom=${encodeURIComponent('2026-02-02T00:00:00Z')}&occurredTo=${encodeURIComponent('2026-02-01T00:00:00Z')}`],
        ['repeated action', 'action=a&action=b'],
        ['repeated actorId', `actorId=${ACTOR_A}&actorId=${ACTOR_B}`],
        ['NUL byte in action', 'action=a%00b'],
        ['NUL byte in scope', 'scope=%00'],
      ])('[rule-foundation-audit-filters] %s answers 400 api.validation.incoming_failed', async (_label, query) => {
        const res = await list(`?${query}`)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      })

      it('[rule-foundation-audit-filters] boundary values are accepted: 100-char action and objectType, 50-char scope, size 1/100, from 0', async () => {
        const res = await list(`?action=${'a'.repeat(100)}&objectType=${'o'.repeat(100)}&scope=${'s'.repeat(50)}&size=100&from=0`)
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ entries: [], total: 0 })
      })

      it('[rule-foundation-audit-filters] a filter value is matched as is: no wildcard, no trimming', async () => {
        await seedEntry({ action: 'groups:update', objectId: 'x' })
        expect((await list(qs({ action: '%' }))).body.total).toBe(0)
        expect((await list(qs({ action: 'groups:%' }))).body.total).toBe(0)
        expect((await list(qs({ action: ' groups:update' }))).body.total).toBe(0)
        expect((await list(qs({ action: "x' or '1'='1" }))).body.total).toBe(0)
      })
    })

    it('[rule-foundation-audit-admin-only] an ordinary user gets 403 security.access_denied', async () => {
      await seedEntry()
      const res = await list('', user.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
      expect(JSON.stringify(res.body)).not.toContain('auteur-a@example.com')
    })

    it('[rule-foundation-audit-admin-only] an anonymous caller gets 401', async () => {
      expect((await list('', null)).status).toBe(401)
    })

    it('[rule-foundation-audit-admin-only] an invalid token gets 401', async () => {
      expect((await list('', 'not-a-token')).status).toBe(401)
    })

    it('[rule-foundation-audit-admin-only] an ordinary user is refused before validation of the query (no information leak on bad input)', async () => {
      const res = await list('?size=0', user.token)
      expect(res.status).toBe(403)
    })

    it('[rule-foundation-audit-reads-not-traced] reading the journal and its filters leaves no new entry', async () => {
      await seedEntry()
      await list()
      await list(qs({ action: 'groups:update' }))
      await call('GET', '/audit-logs/filters', admin.token)
      expect(await countEntries()).toBe(1)
      expect((await list()).body.total).toBe(1)
    })
  })

  describe('GET /audit-logs/filters', () => {
    const filters = (token: string | null = admin.token) => call('GET', '/audit-logs/filters', token ?? undefined)

    it('[rule-foundation-audit-filter-options-from-journal] an empty journal gives four empty lists, whatever the users and scopes tables hold', async () => {
      await sql('insert into base.scopes (code, name, created_at, updated_at) values ($1, $2, now(), now())', ['jamais-trace', 'Jamais tracé'])
      const res = await filters()
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ actors: [], actions: [], objectTypes: [], scopes: [] })
    })

    it('[rule-foundation-audit-filter-options-from-journal] returns the distinct values present in the journal, sorted', async () => {
      await seedEntry({ actorId: ACTOR_B, actorEmail: 'bravo@example.com', action: 'scopes:update', objectType: 'Périmètre', scope: 'site-2' })
      await seedEntry({ actorId: ACTOR_A, actorEmail: 'alpha@example.com', action: 'groups:create', objectType: 'Groupe', scope: null })
      await seedEntry({ actorId: ACTOR_A, actorEmail: 'alpha@example.com', action: 'groups:create', objectType: 'Groupe', scope: 'site-1' })
      await seedEntry({ actorId: ACTOR_B, actorEmail: 'bravo@example.com', action: 'groups:update', objectType: 'Groupe', scope: 'site-1' })
      const res = await filters()
      expect(res.status).toBe(200)
      expect(Object.keys(res.body).sort()).toEqual(['actions', 'actors', 'objectTypes', 'scopes'])
      expect(res.body.actors).toEqual([
        { id: ACTOR_A, email: 'alpha@example.com' },
        { id: ACTOR_B, email: 'bravo@example.com' },
      ])
      expect(res.body.actions).toEqual(['groups:create', 'groups:update', 'scopes:update'])
      expect(res.body.objectTypes).toEqual(['Groupe', 'Périmètre'])
      expect(res.body.scopes).toEqual(['site-1', 'site-2'])
    })

    it('[rule-foundation-audit-filter-options-from-journal] scopes never contain null', async () => {
      await seedEntry({ scope: null })
      expect((await filters()).body.scopes).toEqual([])
    })

    it('[rule-foundation-audit-filter-options-from-journal] actors are sorted by e-mail ignoring case, then id', async () => {
      await seedEntry({ actorId: ACTOR_A, actorEmail: 'Zoe@example.com' })
      await seedEntry({ actorId: ACTOR_B, actorEmail: 'anna@example.com' })
      await seedEntry({ actorId: '33333333-3333-4333-8333-333333333333', actorEmail: 'Marc@example.com' })
      const res = await filters()
      expect(res.body.actors.map((a: any) => a.email)).toEqual(['anna@example.com', 'Marc@example.com', 'Zoe@example.com'])
    })

    it('[rule-foundation-audit-filter-options-from-journal] an author appears once, with the e-mail of their latest entry', async () => {
      await seedEntry({ occurredAt: '2026-01-01T00:00:00.000Z', actorId: ACTOR_A, actorEmail: 'ancien@example.com' })
      await seedEntry({ occurredAt: '2026-02-01T00:00:00.000Z', actorId: ACTOR_A, actorEmail: 'recent@example.com' })
      await seedEntry({ occurredAt: '2026-01-15T00:00:00.000Z', actorId: ACTOR_A, actorEmail: 'milieu@example.com' })
      const res = await filters()
      expect(res.body.actors).toEqual([{ id: ACTOR_A, email: 'recent@example.com' }])
    })

    it('[rule-foundation-audit-survives-author-deletion] an author whose account was deleted is still proposed, with the recorded e-mail', async () => {
      const gone = await createUser({ email: 'supprime@example.com', password: PASSWORD, role: 'user' })
      await seedEntry({ actorId: gone.id, actorEmail: 'supprime@example.com' })
      await sql('delete from base.credentials where user_id = $1', [gone.id])
      await sql('delete from base.group_users where user_id = $1', [gone.id])
      await sql('delete from base.users where id = $1', [gone.id])
      const res = await filters()
      expect(res.body.actors).toEqual([{ id: gone.id, email: 'supprime@example.com' }])
    })

    it('[rule-foundation-audit-filter-options-from-journal] accounts that never acted are not proposed as authors', async () => {
      await seedEntry({ actorId: ACTOR_A, actorEmail: 'acteur@example.com' })
      const res = await filters()
      expect(res.body.actors.map((a: any) => a.email)).toEqual(['acteur@example.com'])
    })

    it('[rule-foundation-audit-filter-options-from-journal] lists are bounded to 1000 elements', async () => {
      await sql(
        `insert into base.audit_logs (occurred_at, actor_id, actor_email, action, object_type, object_id, scope_code, summary)
         select '2026-01-01T00:00:00.000Z', gen_random_uuid(), 'u' || lpad(n::text, 5, '0') || '@example.com',
                'feat:act' || lpad(n::text, 5, '0'), 'Type' || lpad(n::text, 5, '0'), 'o' || n,
                'sc' || lpad(n::text, 5, '0'), 'Résumé ' || n
         from generate_series(1, 1050) n`,
      )
      const res = await filters()
      expect(res.status).toBe(200)
      for (const key of ['actors', 'actions', 'objectTypes', 'scopes']) {
        expect(res.body[key]).toHaveLength(1000)
      }
      expect(res.body.actions[0]).toBe('feat:act00001')
      expect(res.body.actions[999]).toBe('feat:act01000')
      expect(res.body.actors[0].email).toBe('u00001@example.com')
    })

    it('[rule-foundation-audit-filter-options-from-journal] query parameters are ignored', async () => {
      await seedEntry()
      const res = await call('GET', '/audit-logs/filters?size=0&action=zzz', admin.token)
      expect(res.status).toBe(200)
      expect(res.body.actions).toEqual(['groups:update'])
    })

    it('[rule-foundation-audit-admin-only] an ordinary user gets 403 security.access_denied', async () => {
      await seedEntry()
      const res = await filters(user.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
    })

    it('[rule-foundation-audit-admin-only] an anonymous caller gets 401', async () => {
      expect((await filters(null)).status).toBe(401)
    })
  })

  describe('immutability', () => {
    it.each([
      ['/audit-logs'],
      ['/audit-logs/filters'],
      ['/audit-logs/:id'],
    ])('[rule-foundation-audit-immutable] POST, PUT, PATCH and DELETE on %s never succeed, for any role, and the journal is unchanged', async (path) => {
      const id = await seedEntry({ objectId: 'intact', summary: 'Résumé intact' })
      const before = await allEntries()
      const target = path === '/audit-logs/:id' ? `/audit-logs/${id}` : path
      for (const token of [admin.token, user.token, undefined]) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const res = await call(method, target, token, method === 'DELETE' ? undefined : { summary: 'pirate', action: 'x:y' })
          expect(res.status).toBeGreaterThanOrEqual(400)
          if (token === admin.token) expect(res.status).toBe(404)
          if (token === undefined) expect([401, 404]).toContain(res.status)
        }
      }
      expect(await allEntries()).toEqual(before)
    })

    it('[rule-foundation-audit-immutable] the database refuses to update an entry', async () => {
      const id = await seedEntry({ summary: 'Original' })
      await expect(sql("update base.audit_logs set summary = 'Falsifie' where id = $1", [id])).rejects.toThrow()
      await expect(sql("update base.audit_logs set actor_email = 'x@example.com'")).rejects.toThrow()
      const rows = await sql('select summary, actor_email from base.audit_logs where id = $1', [id])
      expect(rows).toEqual([{ summary: 'Original', actor_email: 'auteur-a@example.com' }])
    })

    it('[rule-foundation-audit-immutable] the database refuses to delete an entry', async () => {
      const id = await seedEntry()
      await expect(sql('delete from base.audit_logs where id = $1', [id])).rejects.toThrow()
      await expect(sql('delete from base.audit_logs')).rejects.toThrow()
      expect(await countEntries()).toBe(1)
    })

    it('[rule-foundation-audit-survives-author-deletion] deleting the author account changes no entry', async () => {
      const gone = await createUser({ email: 'ephemere@example.com', password: PASSWORD, role: 'admin' })
      await seedEntry({ actorId: gone.id, actorEmail: 'ephemere@example.com' })
      const before = await allEntries()
      await sql('delete from base.credentials where user_id = $1', [gone.id])
      await sql('delete from base.users where id = $1', [gone.id])
      expect(await allEntries()).toEqual(before)
    })
  })
})
