import { resetData, closePool } from './harness'
import {
  World, get, http, expectRes, ok, setupWorld, daysFromToday, RestTools, openConversation, descendTo, commitmentFor, paymentsFile, importOk, activatePolicy, policyDoc,
  standardLadder, SIREN_A,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : cinq indicateurs agrégés, chacun en deux termes.

const D = (n: number) => daysFromToday(n)
const ROW_KEYS = ['agentVersion', 'collected', 'commitments', 'complaints', 'discounts', 'errors', 'policyVersion', 'segment']

describe('Recouvrement - indicateurs', () => {
  let w: World
  let sup: string
  let ind: string
  let agent: RestTools

  beforeEach(async () => {
    await resetData()
    w = new World()
  })
  afterAll(async () => {
    await closePool()
  })

  async function world(invoices: Inv[]) {
    await setupWorld({ invoices }, w)
    sup = await w.tok('sup')
    ind = await w.tok('ind')
    agent = new RestTools(await w.tok('agent'), 'voice', 'agent-1.0')
  }
  const rows = async (q = '', token = sup) => ok(await get(`/indicators?rowSize=100${q}`, token)).rows as any[]
  const sum = (list: any[], path: (r: any) => number) => list.reduce((s, r) => s + path(r), 0)
  async function commit(debtor: string, rank: number, tools: RestTools = agent) {
    const caseId = await w.caseId(debtor)
    const conv = `c-${debtor}`
    await openConversation(tools, conv, caseId, await w.contactId(debtor))
    const offer = await descendTo(tools, conv, caseId, rank)
    const res = await tools.commit(conv, caseId, commitmentFor(offer))
    return { caseId, conv, offer, res }
  }

  describe('accès', () => {
    it('[rule-recouvrement-indicators-aggregate-only] the supervisor and the indicators reader read the two routes; the litigation service, the agent, a plain user and a profile-less admin get 403; 401 without token', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
      for (const path of ['/indicators', '/indicators/filters']) {
        expect([path, (await get(path, sup)).status]).toEqual([path, 200])
        expect([path, (await get(path, ind)).status]).toEqual([path, 200])
        expect([path, (await get(path)).status]).toEqual([path, 401])
        for (const who of ['lit', 'agent', 'user', 'admin'] as const) {
          const res = await get(path, await w.tok(who))
          expect([who, path, res.status, res.body?.code]).toEqual([who, path, 403, 'security.access_denied'])
        }
      }
      expectRes(await get('/indicators?from=2026-12-31&to=2026-01-01', await w.tok('lit')), 403, 'security.access_denied')
    })

    it('[rule-recouvrement-indicators-aggregate-only] the indicators reader gets 403 security.access_denied on every other recouvrement route', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
      const caseId = await w.caseId('D1')
      const calls: [string, string, unknown?][] = [
        ['GET', '/cases'], ['GET', `/cases/${caseId}`], ['GET', `/cases/${caseId}/decisions`], ['GET', '/invoices?number=F'], ['GET', '/policy-versions'], ['GET', '/decision-queue/items'],
        ['GET', '/decision-queue/counts'], ['GET', '/daily-batches'], ['POST', '/daily-batches'], ['GET', '/ledger-outputs'], ['GET', '/ledger-outputs/export'], ['GET', '/review-samples'],
        ['POST', '/review-samples', {}], ['GET', '/disputes'], ['GET', '/recovery-imports/status'], ['GET', '/profiles/me'], ['GET', '/audit-logs'], ['GET', '/user-profiles'],
        ['POST', '/agent/messages/check', {}], ['POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }],
      ]
      for (const [method, path, body] of calls) {
        const res = await http(method, path, ind, body)
        if (path === '/profiles/me') {
          expect([path, res.status]).toEqual([path, 200])
          continue
        }
        expect([method, path, res.status, res.body?.code]).toEqual([method, path, 403, 'security.access_denied'])
      }
    })
  })

  describe('forme', () => {
    it('[rule-recouvrement-indicators-five][rule-recouvrement-indicators-no-score][rule-recouvrement-indicators-dimensions] each row is a triple (segment, policy version, agent version) with the five indicators in two terms; no ratio, no percentage, no score', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
      await commit('D1', 1)
      const res = await get('/indicators', sup)
      expectRes(res, 200)
      expect(Object.keys(res.body).sort()).toEqual(['rows', 'total'])
      expect(res.body.total).toBeGreaterThanOrEqual(1)
      for (const r of res.body.rows) {
        expect(Object.keys(r).sort()).toEqual(ROW_KEYS)
        expect(Object.keys(r.collected).sort()).toEqual(['collectedCents', 'dueCents'])
        expect(Object.keys(r.commitments).sort()).toEqual(['heldCount', 'takenCount'])
        expect(Object.keys(r.discounts).sort()).toEqual(['dueCents', 'grantedCents'])
        expect(Object.keys(r.complaints).sort()).toEqual(['actionCount', 'complaintCount'])
        expect(Object.keys(r.errors).sort()).toEqual(['errorCount', 'reviewedCount'])
        for (const group of [r.collected, r.commitments, r.discounts, r.complaints, r.errors]) for (const v of Object.values(group)) expect(Number.isInteger(v)).toBe(true)
        expect(typeof r.segment).toBe('string')
      }
      expect(JSON.stringify(res.body)).not.toMatch(/ratio|percent|score|rate|average|moyenne/i)
      const row = res.body.rows.find((r: any) => r.commitments.takenCount === 1)
      expect(row).toMatchObject({ segment: 'standard', agentVersion: 'agent-1.0', policyVersion: { id: w.policyId, label: expect.any(String) } })
      expect(Object.keys(row.policyVersion).sort()).toEqual(['id', 'label'])
    })

    it('[rule-recouvrement-indicators-aggregate-only] no row carries a customer id, a SIREN, a contact or an invoice number', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
      const { caseId, conv } = await commit('D1', 1)
      await agent.complaint(conv, caseId, { text: 'Réclamation de Dupont' })
      const text = JSON.stringify(await rows())
      for (const forbidden of ['D1', 'FA-001', SIREN_A, 'example.test', '+33', 'Dupont', caseId]) expect(text).not.toContain(forbidden)
    })

    it('[rule-recouvrement-indicators-dimensions] a dimension without object is null: no agent version for the facts that come from the data alone', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
      await w.prepareBatch()
      const all = await rows()
      const orderRow = all.find((r) => r.agentVersion === null && r.complaints.actionCount > 0)
      expect(orderRow).toBeDefined()
      expect(orderRow.complaints.actionCount).toBe(1)
    })
  })

  describe('faits', () => {
    it('[rule-recouvrement-indicator-commitments] commitments taken and held count per policy and agent version at the registration', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }])
      await commit('D1', 1)
      await commit('D2', 1)
      await importOk(sup, 'payments', paymentsFile([{ reference: 'VIR FA-001', montant: 100000, date: D(0) }], D(0)))
      const all = await rows()
      expect(sum(all, (r) => r.commitments.takenCount)).toBe(2)
      expect(sum(all, (r) => r.commitments.heldCount)).toBe(1)
      expect(all.filter((r) => r.commitments.takenCount > 0).every((r) => r.agentVersion === 'agent-1.0' && r.policyVersion.id === w.policyId)).toBe(true)
    })

    it('[rule-recouvrement-indicator-discounts] on held commitments, discounts granted over the negotiable amounts at the registration', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }])
      await commit('D1', 2)
      await commit('D2', 2)
      await importOk(sup, 'payments', paymentsFile([{ reference: 'VIR FA-001', montant: 90000, date: D(0) }], D(0)))
      const all = await rows()
      expect(sum(all, (r) => r.discounts.grantedCents)).toBe(10000)
      expect(sum(all, (r) => r.discounts.dueCents)).toBe(100000)
    })

    it('[rule-recouvrement-indicator-complaints] complaints over actions: reported complaints; actions are the conversations opened plus the orders of the ready batches (the latter without agent version)', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, late: 10 }])
      const one = await w.caseId('D1')
      await openConversation(agent, 'c-1', one, await w.contactId('D1'))
      await openConversation(agent, 'c-2', await w.caseId('D2'), await w.contactId('D2'))
      expect((await agent.complaint('c-1', one, { text: 'Plainte' })).status).toBe(201)
      await w.prepareBatch()
      const all = await rows()
      expect(sum(all, (r) => r.complaints.complaintCount)).toBe(1)
      expect(sum(all, (r) => r.complaints.actionCount)).toBe(4)
      expect(sum(all.filter((r) => r.agentVersion === null), (r) => r.complaints.actionCount)).toBe(2)
      expect(sum(all.filter((r) => r.agentVersion === 'agent-1.0'), (r) => r.complaints.actionCount)).toBe(2)
    })

    it('[rule-recouvrement-indicator-complaints] a complaint does not change the state of the case, an unsent batch counts no action', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
      const caseId = await w.caseId('D1')
      await openConversation(agent, 'c-1', caseId, await w.contactId('D1'))
      await agent.complaint('c-1', caseId, { text: 'Plainte' })
      expect((await w.caseDetail('D1')).state).toBe('open')
      expect(sum(await rows(), (r) => r.complaints.actionCount)).toBe(1)
    })

    it('[rule-recouvrement-indicator-collected] before the horizon of the rule is reached nothing is due or collected; the two terms are integers in cents', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
      await importOk(sup, 'payments', paymentsFile([{ reference: 'VIR FA-001', montant: 20000, date: D(0) }], D(0)))
      const all = await rows()
      expect(sum(all, (r) => r.collected.dueCents)).toBe(0)
      expect(sum(all, (r) => r.collected.collectedCents)).toBe(0)
    })
  })

  describe('filtres, période et tri', () => {
    it('[rule-recouvrement-indicators-dimensions] rows are sorted by segment, then by policy version date (newest first), then by agent version with the null last', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, segment: 'premium' }])
      const first = w.policyId!
      await commit('D1', 1)
      const second = await activatePolicy(sup, policyDoc({ versionDate: '2026-10-05', ruleOverrides: { 'standard/family': { ladder: standardLadder('family', [10000, 9400, 9000, 8800]) } } }))
      await commit('D2', 1)
      const agent2 = new RestTools(await w.tok('agent'), 'voice', 'agent-0.9')
      const caseId = await w.caseId('D1')
      await openConversation(agent2, 'c-old', caseId, await w.contactId('D1'))
      await w.prepareBatch()
      const all = (await rows()).map((r) => [r.segment, r.policyVersion?.id ?? null, r.agentVersion])
      const segments = all.map((r) => r[0])
      expect(segments).toEqual([...segments].sort())
      const standard = all.filter((r) => r[0] === 'standard')
      const agents = standard.filter((r) => r[1] === first).map((r) => r[2])
      expect(agents).toEqual([...agents].sort((a, b) => (a === null ? 1 : b === null ? -1 : String(a).localeCompare(String(b)))))
      expect(new Set(all.map((r) => r[1])).has(second)).toBe(true)
    })

    it('[rule-recouvrement-indicators-period][rule-recouvrement-indicators-dimensions] the filters segment, policyVersionId and agentVersion narrow the rows; the period bounds are inclusive civil days', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, segment: 'premium' }])
      await commit('D1', 1)
      await commit('D2', 1)
      expect(sum(await rows('&segment=premium'), (r) => r.commitments.takenCount)).toBe(1)
      expect((await rows('&segment=premium')).every((r) => r.segment === 'premium')).toBe(true)
      expect(sum(await rows(`&policyVersionId=${w.policyId}`), (r) => r.commitments.takenCount)).toBe(2)
      expect(sum(await rows('&agentVersion=agent-1.0'), (r) => r.commitments.takenCount)).toBe(2)
      expect(sum(await rows('&agentVersion=autre'), (r) => r.commitments.takenCount)).toBe(0)
      expect(sum(await rows(`&from=${D(0)}&to=${D(0)}`), (r) => r.commitments.takenCount)).toBe(2)
      expect(sum(await rows(`&from=${D(1)}`), (r) => r.commitments.takenCount)).toBe(0)
      expect(sum(await rows(`&to=${D(-1)}`), (r) => r.commitments.takenCount)).toBe(0)
      expect(sum(await rows(`&from=${D(-30)}&to=${D(30)}`), (r) => r.commitments.takenCount)).toBe(2)
    })

    it('[rule-recouvrement-indicators-period] the pagination of rows and the validation of the filters: from after to, bad dates, bad sizes, bad uuid, bad agent version', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, segment: 'premium' }])
      await commit('D1', 1)
      await commit('D2', 1)
      const all = ok(await get('/indicators?rowSize=100', sup))
      expect(all.total).toBe(all.rows.length)
      const page = ok(await get('/indicators?rowFrom=1&rowSize=1', sup))
      expect(page.rows).toHaveLength(1)
      expect(page.total).toBe(all.total)
      expect(ok(await get('/indicators', sup)).rows.length).toBeLessThanOrEqual(25)
      for (const q of [`from=${D(1)}&to=${D(0)}`, 'from=hier', 'to=2026-13-01', 'rowSize=0', 'rowSize=101', 'rowFrom=-1', 'rowFrom=2147483648', 'policyVersionId=x', 'agentVersion=a%20b', `agentVersion=${'a'.repeat(51)}`, 'segment=', `segment=${'s'.repeat(51)}`]) {
        expectRes(await get(`/indicators?${q}`, sup), 400, 'api.validation.incoming_failed')
      }
      expect(ok(await get(`/indicators?from=${D(0)}&to=${D(0)}`, sup))).toHaveProperty('rows')
    })

    it('[rule-recouvrement-indicators-dimensions] the filters route lists the segments, the policy versions (id, label, date) and the agent versions present', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, segment: 'premium' }])
      await commit('D1', 1)
      await commit('D2', 1)
      const res = ok(await get('/indicators/filters', ind))
      expect(Object.keys(res).sort()).toEqual(['agentVersions', 'policyVersions', 'segments'])
      expect(res.segments).toEqual(expect.arrayContaining(['premium', 'standard']))
      expect(res.agentVersions).toEqual(['agent-1.0'])
      expect(res.policyVersions).toEqual([{ id: w.policyId, label: expect.any(String), versionDate: '2026-10-01' }])
      expect(JSON.stringify(res)).not.toMatch(/D1|FA-00/)
    })
  })
})
