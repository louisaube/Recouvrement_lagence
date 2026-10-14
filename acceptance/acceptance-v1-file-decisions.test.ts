import { resetData, closePool } from './harness'
import {
  World, get, post, http, expectRes, ok, UNKNOWN_UUID, setupWorld, daysFromToday, ruleFor, importOk, paymentsFile, RestTools, openConversation, descendTo, strip,
  DISPUTES_HEADER,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : file de décisions du superviseur.

const D = (n: number) => daysFromToday(n)
const ITEM_KEYS = ['allowedDecisions', 'candidates', 'caseId', 'createdAt', 'debtorId', 'decision', 'details', 'id', 'status', 'summary', 'type']
const TYPES = ['contestation', 'amount_over_threshold', 'ladder_exhausted', 'unassigned_payment', 'accounting_gap', 'prescription_near', 'prescription_expired', 'alert', 'human_request', 'transfer_proposed']

describe('Recouvrement - file de décisions', () => {
  let w: World
  let sup: string
  let agent: RestTools

  beforeEach(async () => {
    await resetData()
    w = new World()
  })
  afterAll(async () => {
    await closePool()
  })

  async function world(invoices: Inv[], policy: any = {}) {
    await setupWorld({ invoices, policy }, w)
    sup = await w.tok('sup')
    agent = new RestTools(await w.tok('agent'), 'voice')
  }
  const decide = (id: string, decision: string, reason = 'Décision de recette', extra: object = {}) => post(`/decision-queue/items/${id}/decision`, sup, { decision, reason, ...extra })
  const open = async (debtor: string, conv = `c-${debtor}`) => {
    const caseId = await w.caseId(debtor)
    await openConversation(agent, conv, caseId, await w.contactId(debtor))
    return { caseId, conv }
  }
  const only = async (type: string) => {
    const items = await w.queueItems(`&type=${type}`)
    expect(items).toHaveLength(1)
    return items[0]
  }
  const gros = (n = 50000) => ruleFor('gros', 'family', { thresholdCents: n })
  const BIG: Inv[] = [{ numero: 'FA-001', debiteur: 'D1', montant: 90000, segment: 'gros' }]

  describe('lecture', () => {
    it('[rule-recouvrement-queue-contents] only the supervisor reads and decides: 403 for the other profiles, a plain user, an admin without profile; 401 without token; the 403 comes before the validation', async () => {
      await world(BIG, { extraRules: [gros()] })
      await w.prepareBatch()
      const item = await only('amount_over_threshold')
      const calls: [string, string, unknown?][] = [
        ['GET', '/decision-queue/items'], ['GET', '/decision-queue/counts'], ['POST', `/decision-queue/items/${item.id}/decision`, { decision: 'authorize', reason: 'x' }],
        ['POST', `/decision-queue/items/${item.id}/decision`, { decision: 5 }],
      ]
      for (const [method, path, body] of calls) {
        expect([method, path, (await http(method, path, undefined, body)).status]).toEqual([method, path, 401])
        for (const who of ['agent', 'lit', 'ind', 'user', 'admin'] as const) {
          const res = await http(method, path, await w.tok(who), body)
          expect([who, method, path, res.status, res.body?.code]).toEqual([who, method, path, 403, 'security.access_denied'])
        }
      }
      expect((await w.queueItems('&type=amount_over_threshold'))[0].status).toBe('open')
    })

    it('[rule-recouvrement-queue-contents] the counts give the ten types, only the open items; an empty queue counts zeros', async () => {
      await world(BIG, { extraRules: [gros()] })
      const empty = ok(await get('/decision-queue/counts', sup))
      expect(empty.total).toBe(0)
      expect(Object.keys(empty.byType).sort()).toEqual([...TYPES].sort())
      for (const t of TYPES) expect(empty.byType[t]).toBe(0)
      await w.prepareBatch()
      const counts = ok(await get('/decision-queue/counts', sup))
      expect(counts.total).toBe(1)
      expect(counts.byType.amount_over_threshold).toBe(1)
    })

    it('[rule-recouvrement-queue-order][rule-recouvrement-queue-contents] the open queue reads from the oldest to the newest, the decided one from the most recently decided; items carry their summary and details in French, the types are filterable, the pagination bounded', async () => {
      await world([
        { numero: 'FA-001', debiteur: 'D1', montant: 90000, segment: 'gros' }, { numero: 'FA-002', debiteur: 'D2', montant: 90000, segment: 'gros' }, { numero: 'FA-003', debiteur: 'D3', montant: 90000, segment: 'gros' },
      ], { extraRules: [gros()] })
      await w.prepareBatch()
      const open_ = await w.queueItems()
      expect(open_).toHaveLength(3)
      const created = open_.map((i: any) => i.createdAt)
      expect(created).toEqual([...created].sort())
      for (const i of open_) {
        expect(Object.keys(i).sort()).toEqual(ITEM_KEYS)
        expect(i).toMatchObject({ type: 'amount_over_threshold', status: 'open', decision: null, candidates: [] })
        expect(i.summary.length).toBeGreaterThanOrEqual(1)
        expect(i.summary.length).toBeLessThanOrEqual(300)
        expect(i.details.length).toBeLessThanOrEqual(20)
        for (const d of i.details) {
          expect(d.label.length).toBeGreaterThanOrEqual(1)
          expect(d.value.length).toBeLessThanOrEqual(300)
        }
      }
      expect(ok(await get('/decision-queue/items?from=1&size=1', sup)).items).toHaveLength(1)
      await decide(open_[2].id, 'authorize')
      await decide(open_[0].id, 'transfer')
      const decided = ok(await get('/decision-queue/items?status=decided', sup))
      expect(decided.total).toBe(2)
      expect(decided.items.map((i: any) => i.id)).toEqual([open_[0].id, open_[2].id])
      expect(decided.items[0].decision).toMatchObject({ code: 'transfer', reason: 'Décision de recette', decidedBy: { id: (await w.acc('sup')).id, email: 'sup@recette.test' } })
      expect(decided.items[0].allowedDecisions).toEqual([])
      expect(ok(await get('/decision-queue/items?type=human_request', sup)).total).toBe(0)
      for (const q of ['status=autre', 'type=autre', 'size=0', 'size=101', 'from=-1', 'from=2147483648']) expectRes(await get(`/decision-queue/items?${q}`, sup), 400, 'api.validation.incoming_failed')
    })
  })

  describe('décisions', () => {
    it('[rule-recouvrement-queue-decision-motivated] the reason is required (1 to 1000 characters after trimming), the code 1 to 50 characters, the body strict, the id a uuid; an unknown item is 404', async () => {
      await world(BIG, { extraRules: [gros()] })
      await w.prepareBatch()
      const item = await only('amount_over_threshold')
      for (const body of [{}, { decision: 'authorize' }, { reason: 'x' }, { decision: 'authorize', reason: '' }, { decision: 'authorize', reason: '   ' }, { decision: 'authorize', reason: 'r'.repeat(1001) }, { decision: '', reason: 'x' }, { decision: 'd'.repeat(51), reason: 'x' }, { decision: 'authorize', reason: 'x', extra: 1 }, { decision: 'authorize', reason: 'x', invoiceId: UNKNOWN_UUID }, { decision: 'authorize', reason: 'x', invoiceId: 'pas-un-uuid' }]) {
        expect([JSON.stringify(body).slice(0, 60), (await post(`/decision-queue/items/${item.id}/decision`, sup, body)).status]).toEqual([JSON.stringify(body).slice(0, 60), 400])
      }
      expectRes(await post('/decision-queue/items/pas-un-uuid/decision', sup, { decision: 'authorize', reason: 'x' }), 400, 'api.validation.incoming_failed')
      expectRes(await decide(UNKNOWN_UUID, 'authorize'), 404, 'repository.not_found')
      expect((await only('amount_over_threshold')).status).toBe('open')
      expectRes(await decide(item.id, 'authorize', 'r'.repeat(1000)), 200)
    })

    it('[rule-recouvrement-queue-decision-motivated] the decision keeps its code, trimmed reason, author and instant; it enters the audit journal without the reason', async () => {
      await world(BIG, { extraRules: [gros()] })
      await w.prepareBatch()
      const item = await only('amount_over_threshold')
      const res = await decide(item.id, 'authorize', '  Client historique, négociation autorisée  ')
      expectRes(res, 200)
      expect(res.body.item).toMatchObject({ id: item.id, status: 'decided', allowedDecisions: [], decision: { code: 'authorize', reason: 'Client historique, négociation autorisée' } })
      expect(res.body.item.decision.decidedAt).toEqual(expect.any(String))
      const log = ok(await get('/audit-logs?action=queue:decide', sup))
      expect(log.total).toBe(1)
      expect(log.entries[0].summary).toBe('Décision « Autoriser la négociation » sur un élément « Montant au-delà du seuil ».')
      expect(JSON.stringify(log.entries)).not.toContain('Client historique')
    })

    it('[rule-recouvrement-queue-decided-final] a decided item does not change: 409 queue.already_decided; two simultaneous decisions give one success and one 409', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 90000, segment: 'gros' }, { numero: 'FA-002', debiteur: 'D2', montant: 90000, segment: 'gros' }], { extraRules: [gros()] })
      await w.prepareBatch()
      const [a, b] = await w.queueItems()
      expectRes(await decide(a.id, 'authorize'), 200)
      expectRes(await decide(a.id, 'authorize'), 409, 'queue.already_decided')
      expectRes(await decide(a.id, 'transfer'), 409, 'queue.already_decided')
      expectRes(await decide(a.id, 'unknown'), 409)
      const race = await Promise.all([decide(b.id, 'authorize'), decide(b.id, 'transfer')])
      expect(race.map((r) => r.status).sort()).toEqual([200, 409])
      expect(race.find((r) => r.status === 409)!.body.code).toBe('queue.already_decided')
    })

    it('[rule-recouvrement-queue-single-open] a repeated event creates no second open item for the same type and object', async () => {
      await world(BIG, { extraRules: [gros()] })
      await w.prepareBatch()
      await w.prepareBatch().catch(() => undefined)
      await importOk(sup, 'payments', paymentsFile([{ reference: 'REF-ZZZ', montant: 100, date: D(0) }], D(0)))
      expect((await w.queueItems('&type=amount_over_threshold')).length).toBe(1)
    })
  })

  describe('effets', () => {
    it('[rule-recouvrement-queue-effects] a negotiable amount above the authorized one puts the case in the queue again', async () => {
      await world(BIG, { extraRules: [gros()] })
      await w.prepareBatch()
      await decide((await only('amount_over_threshold')).id, 'authorize')
      extraction += 1
      const rows: Inv[] = [{ numero: 'FA-001', debiteur: 'D1', montant: 90000, segment: 'gros' }, { numero: 'FA-009', debiteur: 'D1', montant: 20000, segment: 'gros' }]
      await w.receivables(rows, D(-3 + extraction))
      await sql_clear_today_batch()
      await w.prepareBatch()
      expect((await w.queueItems('&type=amount_over_threshold')).length).toBe(1)
    })

    it('[rule-recouvrement-queue-effects] « reject_transfer » closes the item and the brain does not reproduce the proposal while the rule applied to the case is the same', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 120 }])
      await w.prepareBatch()
      await decide((await only('transfer_proposed')).id, 'reject_transfer')
      expect((await w.caseDetail('D1')).state).not.toBe('supervisor_queue')
      await sql_clear_today_batch()
      await w.prepareBatch()
      expect(await w.queueItems('&type=transfer_proposed')).toHaveLength(0)
      expect((await w.caseDetail('D1')).state).not.toBe('supervisor_queue')
    })

  })

  describe('paiements non affectés', () => {
    const TWINS: Inv[] = [
      { numero: 'FA-001', debiteur: 'D1', montant: 10000 }, { numero: 'FA-002', debiteur: 'D2', montant: 10000 }, { numero: 'FA-003', debiteur: 'D3', montant: 4000 },
    ]
    async function unassigned(amount = 10000) {
      await importOk(sup, 'payments', paymentsFile([{ reference: 'VIR INCONNU', montant: amount, date: D(0) }], D(0)))
      return only('unassigned_payment')
    }

    it('[rule-recouvrement-queue-unassigned-until-assigned][rule-recouvrement-unassigned-payment-freeze] an ambiguous payment opens an item with its candidate invoices and freezes the cases until the supervisor assigns it', async () => {
      await world(TWINS)
      const item = await unassigned()
      expect(item.allowedDecisions).toEqual(['assign'])
      expect(item.candidates.map((c: any) => c.number).sort()).toEqual(['FA-001', 'FA-002'])
      expect(Object.keys(item.candidates[0]).sort()).toEqual(['balanceCents', 'caseId', 'creditorSiren', 'debtorId', 'invoiceId', 'number'])
      for (const d of ['D1', 'D2']) expect((await w.caseDetail(d)).state).toBe('frozen')
      expect((await w.caseDetail('D3')).state).toBe('open')
      expect((await w.queueItems('&type=unassigned_payment')).length).toBe(1)
    })

    it('[rule-recouvrement-queue-effects] « assign » requires an invoice (400 without it, 400 with it for another decision), applies the payment, lifts the freeze of the cases and gives them back to the brain', async () => {
      await world(TWINS)
      const item = await unassigned()
      expect((await decide(item.id, 'assign')).status).toBe(400)
      const target = item.candidates.find((c: any) => c.number === 'FA-001')
      const res = await decide(item.id, 'assign', 'Paiement du client D1', { invoiceId: target.invoiceId })
      expectRes(res, 200)
      expect(res.body.item.status).toBe('decided')
      const d1 = await w.caseDetail('D1')
      expect(d1.state).toBe('settled')
      expect((await w.caseDetail('D2')).state).toBe('open')
      expect((await w.caseDetail('D2')).freezes).toEqual([])
    })

    it('[rule-recouvrement-queue-effects] the applied amount is the minimum of the payment and the balance; the excess becomes an unassigned payment and opens a new item', async () => {
      await world(TWINS)
      const item = await unassigned()
      const small = await w.invoiceId('FA-003')
      expectRes(await decide(item.id, 'assign', 'Affectation partielle', { invoiceId: small }), 200)
      expect((await w.caseDetail('D3')).state).toBe('settled')
      const next = await only('unassigned_payment')
      expect(next.id).not.toBe(item.id)
      expect(JSON.stringify([next.summary, next.details])).toMatch(/60[,.]00|6000/)
    })

    it('[rule-recouvrement-queue-effects] an invoice that is unknown, settled or not open is refused: 409 queue.invoice_not_open', async () => {
      await world(TWINS)
      const item = await unassigned()
      expectRes(await decide(item.id, 'assign', 'x', { invoiceId: UNKNOWN_UUID }), 409, 'queue.invoice_not_open')
      const settled = await w.invoiceId('FA-003')
      await importOk(sup, 'payments', paymentsFile([{ reference: 'VIR FA-003', montant: 4000, date: D(0) }], D(0)))
      expectRes(await decide(item.id, 'assign', 'x', { invoiceId: settled }), 409, 'queue.invoice_not_open')
      expect((await only('unassigned_payment')).status).toBe('open')
    })
  })

  async function sql_clear_today_batch() {
    const { sql } = await import('./harness')
    await sql("update base.daily_batches set status = 'blocked' where status = 'ready' and batch_date = current_date")
  }
  let extraction = 0
})
