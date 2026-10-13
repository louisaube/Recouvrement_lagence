import { createHash } from 'node:crypto'
import { resetData, closePool, sql } from './harness'
import {
  World, get, post, http, expectRes, ok, UNKNOWN_UUID, setupWorld, isoWeek, mondayOf, addDays, today, importOk, paymentsFile, daysFromToday, sha256,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : relecture hebdomadaire d'un échantillon de décisions.

const D = (n: number) => daysFromToday(n)
const ITEM_KEYS = ['agreed', 'brainAction', 'brainRule', 'caseId', 'comment', 'debtorId', 'decidedAt', 'id', 'inputs', 'rank', 'reviewedAt', 'reviewedBy', 'status', 'supervisorAction']
const SAMPLE_KEYS = ['disagreementCount', 'drawnAt', 'drawnBy', 'id', 'policyVersion', 'poolSize', 'reviewedCount', 'seed', 'size', 'week', 'weekEnd', 'weekStart']

/** Tirage de référence de la règle, recalculé indépendamment du serveur. */
function expectedDraw(week: string, policyId: string, decisionIds: string[], n: number): string[] {
  const seed = sha256(Buffer.from(`${week}|${policyId}`, 'utf8'))
  const pool = [...decisionIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (let i = pool.length - 1; i >= 1; i--) {
    const j = Number(BigInt('0x' + createHash('sha256').update(`${seed}:${i}`).digest('hex').slice(0, 16)) % BigInt(i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n)
}

describe('Recouvrement - relecture hebdomadaire', () => {
  let w: World
  let sup: string
  const week = isoWeek(today())

  beforeEach(async () => {
    await resetData()
    w = new World()
  })
  afterAll(async () => {
    await closePool()
  })

  const PORTFOLIO: Inv[] = Array.from({ length: 12 }, (_, i) => ({ numero: `FA-${String(i).padStart(3, '0')}`, debiteur: `D${String(i).padStart(2, '0')}`, montant: 100000 + i, late: i % 3 === 0 ? 5 : i % 3 === 1 ? 40 : 0 }))
  async function world(over: object = {}, invoices: Inv[] = PORTFOLIO) {
    await setupWorld({ invoices, ...over }, w)
    sup = await w.tok('sup')
    return ok(await w.prepareBatch()).batch
  }
  /** Décisions journalisées du jour (identifiant, dossier, issue, règle). */
  async function decisions() {
    const cases = ok(await get('/cases?size=100', sup)).items
    const rows: { id: string; caseId: string; debtorId: string; outcome: string; ruleId: string }[] = []
    for (const c of cases) {
      const items = ok(await get(`/cases/${c.id}/decisions?size=100`, sup)).items.filter((d: any) => d.kind === 'daily_action')
      for (const d of items) rows.push({ id: d.id, caseId: c.id, debtorId: c.debtorId, outcome: d.outcome, ruleId: d.ruleId })
    }
    return rows
  }
  const draw = (body: unknown = { week }, token = sup) => post('/review-samples', token, body)
  const items = async (id: string, q = '') => ok(await get(`/review-samples/${id}/items?size=100${q}`, sup))

  describe('accès', () => {
    it('[rule-recouvrement-review-supervisor-only] only the supervisor draws and reviews: 403 for the other profiles, a plain user, a profile-less admin; 401 without token', async () => {
      await world()
      const sample = ok(await draw()).sample
      const item = (await items(sample.id)).items[0]
      const calls: [string, string, unknown?][] = [
        ['GET', '/review-samples'], ['POST', '/review-samples', { week }], ['GET', `/review-samples/${sample.id}`], ['GET', `/review-samples/${sample.id}/items`],
        ['POST', `/review-samples/${sample.id}/items/${item.id}/review`, { action: 'none' }], ['POST', '/review-samples', { week: 5 }],
      ]
      for (const [method, path, body] of calls) {
        expect([method, path, (await http(method, path, undefined, body)).status]).toEqual([method, path, 401])
        for (const who of ['agent', 'lit', 'ind', 'user', 'admin'] as const) {
          const res = await http(method, path, await w.tok(who), body)
          expect([who, method, path, res.status, res.body?.code]).toEqual([who, method, path, 403, 'security.access_denied'])
        }
      }
    })
  })

  describe('tirage', () => {
    it('[rule-recouvrement-review-weekly-sample][rule-recouvrement-review-manual-trigger] the supervisor draws the sample of a week: its size is reviewSampleSize of the active policy, the pool is the daily decisions of the week; the week, its bounds, the seed and the author are given', async () => {
      const batch = await world()
      const res = await draw()
      expectRes(res, 201)
      const s = res.body.sample
      expect(Object.keys(s).sort()).toEqual(SAMPLE_KEYS)
      expect(s).toMatchObject({ week, weekStart: mondayOf(today()), weekEnd: addDays(mondayOf(today()), 6), size: 5, poolSize: 12, reviewedCount: 0, disagreementCount: 0, policyVersion: { id: w.policyId } })
      expect(s.drawnBy).toEqual({ id: (await w.acc('sup')).id, email: 'sup@recette.test' })
      expect(s.seed).toBe(sha256(Buffer.from(`${week}|${w.policyId}`, 'utf8')))
      expect(s.seed).toMatch(/^[0-9a-f]{64}$/)
      expect(batch.status).toBe('ready')
      expect(ok(await get(`/review-samples/${s.id}`, sup)).sample).toEqual(s)
      expect(ok(await get('/review-samples', sup)).items.map((x: any) => x.id)).toEqual([s.id])
    })

    it('[rule-recouvrement-review-reproducible] the draw follows the published algorithm: SHA-256 seed, decisions sorted by identifier, Fisher-Yates driven by SHA-256(seed:i); the items are numbered from 1 in the order drawn', async () => {
      await world()
      const rows = await decisions()
      expect(rows).toHaveLength(12)
      const sample = ok(await draw()).sample
      const expected = expectedDraw(week, w.policyId!, rows.map((r) => r.id), 5)
      const drawn = (await items(sample.id)).items
      expect(drawn.map((i: any) => i.rank)).toEqual([1, 2, 3, 4, 5])
      expect(drawn.map((i: any) => i.caseId)).toEqual(expected.map((id) => rows.find((r) => r.id === id)!.caseId))
    })

    it('[rule-recouvrement-review-reproducible] with a pool smaller than the sample size, all decisions are kept', async () => {
      await world({ policy: { global: { reviewSampleSize: 50 } } })
      const sample = ok(await draw()).sample
      expect(sample).toMatchObject({ size: 12, poolSize: 12 })
      expect(new Set((await items(sample.id)).items.map((i: any) => i.caseId)).size).toBe(12)
    })

    it('[rule-recouvrement-review-pool] a batch replaced the same day does not feed the pool', async () => {
      await setupWorld({ invoices: PORTFOLIO, statement: false }, w)
      sup = await w.tok('sup')
      expect(ok(await w.prepareBatch()).batch.status).toBe('blocked')
      await importOk(sup, 'payments', paymentsFile([{ reference: 'R-1', montant: 100, date: D(-6) }], D(0)))
      expect(ok(await w.prepareBatch()).batch.status).toBe('ready')
      expect(ok(await draw()).sample.poolSize).toBe(12)
    })

    it('[rule-recouvrement-review-weekly-sample] one sample per week: 409 reviews.already_drawn; a future week 409 reviews.week_in_future; a week without decision 409 reviews.no_decisions; without an active policy 409 reviews.no_active_policy', async () => {
      await world()
      expectRes(await draw(), 201)
      expectRes(await draw(), 409, 'reviews.already_drawn')
      const next = isoWeek(addDays(today(), 14))
      expectRes(await draw({ week: next }), 409, 'reviews.week_in_future')
      expectRes(await draw({ week: '2020-W10' }), 409, 'reviews.no_decisions')
      expect(ok(await get('/review-samples', sup)).total).toBe(1)
    })

    it('[rule-recouvrement-review-manual-trigger] without a week, the previous complete ISO week is drawn: no decision was taken then (409 reviews.no_decisions)', async () => {
      await world()
      expectRes(await draw({}), 409, 'reviews.no_decisions')
      expectRes(await post('/review-samples', sup), 409, 'reviews.no_decisions')
    })

    it('[rule-recouvrement-review-weekly-sample] the sample size comes from the active policy at the time of the draw: without an active policy the draw is refused', async () => {
      await world()
      await sql("update base.policy_versions set status = 'superseded' where status = 'active'")
      expectRes(await draw(), 409, 'reviews.no_active_policy')
    })

    it('[rule-recouvrement-review-weekly-sample] the week must look like YYYY-Www with ww from 01 to 53; the body is strict', async () => {
      await world()
      for (const body of [{ week: '2026-W00' }, { week: '2026-W54' }, { week: '2026W41' }, { week: '26-W41' }, { week: '2026-w41' }, { week: 41 }, { week: '' }, { week: '2026-W41', extra: 1 }, { extra: 1 }]) {
        expectRes(await draw(body), 400, 'api.validation.incoming_failed')
      }
    })

    it('[rule-recouvrement-review-weekly-sample] the list goes from the most recent week to the oldest and is paginated; an unknown sample is 404', async () => {
      await world()
      const sample = ok(await draw()).sample
      expect(ok(await get('/review-samples?size=1&from=0', sup)).items).toHaveLength(1)
      expect(ok(await get('/review-samples?from=1', sup)).items).toEqual([])
      for (const q of ['size=0', 'size=101', 'from=-1']) expectRes(await get(`/review-samples?${q}`, sup), 400, 'api.validation.incoming_failed')
      expectRes(await get(`/review-samples/${UNKNOWN_UUID}`, sup), 404, 'repository.not_found')
      expectRes(await get(`/review-samples/${UNKNOWN_UUID}/items`, sup), 404, 'repository.not_found')
      expectRes(await get('/review-samples/x', sup), 400, 'api.validation.incoming_failed')
      expect(sample.id).toBeDefined()
    })
  })

  describe('relecture à l\'aveugle et finale', () => {
    it('[rule-recouvrement-review-blind] before the review an item gives the inputs as they were at the decision time, never the action, the rule or the agreement; the inputs do not follow the current state of the case', async () => {
      await world()
      const sample = ok(await draw()).sample
      const before = (await items(sample.id)).items
      for (const i of before) {
        expect(Object.keys(i).sort()).toEqual(ITEM_KEYS)
        expect(i).toMatchObject({ status: 'to_review', supervisorAction: null, comment: null, reviewedBy: null, reviewedAt: null, brainAction: null, brainRule: null, agreed: null })
        expect(i.inputs.length).toBeGreaterThanOrEqual(1)
        for (const input of i.inputs) {
          expect(input.name.length).toBeGreaterThanOrEqual(1)
          expect(input.name.length).toBeLessThanOrEqual(100)
          expect(input.value.length).toBeLessThanOrEqual(500)
        }
        expect(JSON.stringify(i)).not.toMatch(/r-reminder|r-proposal|r-none|r-transfer|probability|policyVersion|"reminder"|"proposal"/)
      }
      await sql('update base.invoices set due_date = current_date - 200')
      const after = (await items(sample.id)).items
      expect(after.map((i: any) => i.inputs)).toEqual(before.map((i: any) => i.inputs))
    })

    it('[rule-recouvrement-review-gap-feeds-indicator] after the review the item gives the brain action and rule and whether the supervisor agreed; the counts of the sample follow', async () => {
      await world()
      const rows = await decisions()
      const sample = ok(await draw()).sample
      const [first, second, third] = (await items(sample.id)).items
      const brain = (item: any) => rows.find((r) => r.caseId === item.caseId)!
      const agree = await post(`/review-samples/${sample.id}/items/${first.id}/review`, sup, { action: brain(first).outcome, comment: '  Bonne décision  ' })
      expectRes(agree, 200)
      expect(agree.body.item).toMatchObject({
        status: 'reviewed', supervisorAction: brain(first).outcome, comment: 'Bonne décision', brainAction: brain(first).outcome, brainRule: brain(first).ruleId, agreed: true,
        reviewedBy: { id: (await w.acc('sup')).id, email: 'sup@recette.test' },
      })
      expect(agree.body.item.reviewedAt).not.toBeNull()
      const other = ['none', 'reminder', 'proposal', 'transfer_proposed'].find((a) => a !== brain(second).outcome)!
      const disagree = await post(`/review-samples/${sample.id}/items/${second.id}/review`, sup, { action: other })
      expect(disagree.body.item).toMatchObject({ agreed: false, brainAction: brain(second).outcome, comment: null })
      const s = ok(await get(`/review-samples/${sample.id}`, sup)).sample
      expect(s).toMatchObject({ reviewedCount: 2, disagreementCount: 1 })
      expect((await items(sample.id, '&status=reviewed')).items.map((i: any) => i.id).sort()).toEqual([first.id, second.id].sort())
      expect((await items(sample.id, '&status=to_review')).total).toBe(3)
      expect((await items(sample.id)).items.find((i: any) => i.id === third.id).brainAction).toBeNull()
    })

    it('[rule-recouvrement-review-final] a review given is not modified: 409 reviews.already_reviewed', async () => {
      await world()
      const sample = ok(await draw()).sample
      const item = (await items(sample.id)).items[0]
      expectRes(await post(`/review-samples/${sample.id}/items/${item.id}/review`, sup, { action: 'none' }), 200)
      expectRes(await post(`/review-samples/${sample.id}/items/${item.id}/review`, sup, { action: 'reminder' }), 409, 'reviews.already_reviewed')
      expect((await items(sample.id)).items[0].supervisorAction).toBe('none')
    })

    it('[rule-recouvrement-review-final] the action is one of the four daily actions, the comment 1..1000 characters trimmed, the body strict, both ids uuids; an unknown item or sample is 404', async () => {
      await world()
      const sample = ok(await draw()).sample
      const item = (await items(sample.id)).items[0]
      const path = `/review-samples/${sample.id}/items/${item.id}/review`
      for (const body of [{}, { action: 'autre' }, { action: 'none', comment: '' }, { action: 'none', comment: '   ' }, { action: 'none', comment: 'c'.repeat(1001) }, { action: 'none', extra: 1 }, { comment: 'x' }]) {
        expectRes(await post(path, sup, body), 400, 'api.validation.incoming_failed')
      }
      expectRes(await post(`/review-samples/${sample.id}/items/${UNKNOWN_UUID}/review`, sup, { action: 'none' }), 404, 'repository.not_found')
      expectRes(await post(`/review-samples/${UNKNOWN_UUID}/items/${item.id}/review`, sup, { action: 'none' }), 404, 'repository.not_found')
      expectRes(await post(`/review-samples/x/items/${item.id}/review`, sup, { action: 'none' }), 400, 'api.validation.incoming_failed')
      expectRes(await post(path, sup, { action: 'none', comment: 'c'.repeat(1000) }), 200)
    })

    it('[rule-recouvrement-review-supervisor-only] the items are sorted by rank, filtered by status and paginated', async () => {
      await world()
      const sample = ok(await draw()).sample
      expect((await items(sample.id, '&from=2&size=2')).items.map((i: any) => i.rank)).toEqual([3, 4])
      for (const q of ['&status=autre', '&size=0', '&size=101', '&from=-1']) expectRes(await get(`/review-samples/${sample.id}/items?${q.slice(1)}`, sup), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-review-gap-feeds-indicator][rule-recouvrement-indicator-errors] each disagreement counts as an error in the « errors / reviewed decisions » indicator, per segment and policy version, without agent version', async () => {
      await world()
      const rows = await decisions()
      const sample = ok(await draw()).sample
      const [a, b] = (await items(sample.id)).items
      const brain = (item: any) => rows.find((r) => r.caseId === item.caseId)!.outcome
      await post(`/review-samples/${sample.id}/items/${a.id}/review`, sup, { action: brain(a) })
      await post(`/review-samples/${sample.id}/items/${b.id}/review`, sup, { action: ['none', 'reminder', 'proposal', 'transfer_proposed'].find((x) => x !== brain(b)) })
      const indicators = ok(await get('/indicators?rowSize=100', sup)).rows
      const rowsWithErrors = indicators.filter((r: any) => r.errors.reviewedCount > 0)
      expect(rowsWithErrors.reduce((s: number, r: any) => s + r.errors.reviewedCount, 0)).toBe(2)
      expect(rowsWithErrors.reduce((s: number, r: any) => s + r.errors.errorCount, 0)).toBe(1)
      for (const r of rowsWithErrors) {
        expect(r.agentVersion).toBeNull()
        expect(r.policyVersion).toEqual({ id: w.policyId, label: expect.any(String) })
      }
    })

    it('[rule-recouvrement-review-supervisor-only] the draw and the review are traced in the audit journal without free text or customer identifier', async () => {
      await world()
      const sample = ok(await draw()).sample
      const item = (await items(sample.id)).items[0]
      await post(`/review-samples/${sample.id}/items/${item.id}/review`, sup, { action: 'none', comment: 'Commentaire privé' })
      const log = ok(await get('/audit-logs?size=100', sup)).items
      const drawn = log.find((e: any) => e.action === 'reviews:draw')
      const reviewed = log.find((e: any) => e.action === 'reviews:review')
      expect(drawn.summary).toBe(`Échantillon de relecture ${week} tiré : 5 décisions.`)
      expect(reviewed.summary).toBe(`Décision relue sur l'échantillon ${week}.`)
      expect(JSON.stringify(log)).not.toMatch(/Commentaire privé|D0[0-9]/)
    })
  })
})
