import { resetData, closePool } from './harness'
import {
  World, get, expectRes, ok, UNKNOWN_UUID, setupWorld, daysFromToday, policyDoc, ruleFor, runImport, strip, DISPUTES_HEADER, importOk,
  RestTools, openConversation, SIREN_A, SIREN_B, RECEIVABLES_HEADER, receivableRow, euros, receivablesTotal, receivablesFile,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : dossiers (liste, fiche, filtres), recherche de factures, montant négociable,
// prescription, seuil, journal des décisions du cerveau, référentiel des états.

const D = (n: number) => daysFromToday(n)

const SUMMARY_KEYS = ['creditors', 'debtorId', 'id', 'maxDaysLate', 'nature', 'negotiableCents', 'openBalanceCents', 'openInvoices', 'segment', 'state', 'updatedAt']
const DETAIL_KEYS = [...SUMMARY_KEYS, 'activePolicy', 'commitments', 'debtorSiren', 'freezes', 'invoices', 'ledgerOutputs', 'openQueueItems', 'unlockedOffers'].sort()
const INVOICE_KEYS = ['amountCents', 'balanceCents', 'coveredByOutputsCents', 'creditorSiren', 'daysLate', 'dueDate', 'freezeCodes', 'frozen', 'id', 'invoiceDate', 'kind', 'negotiable', 'number', 'prescription', 'prescriptionDate']

/** Transitions permises par le référentiel des états (§2). */
const FROZEN_CAUSES = ['contestation', 'dispute_opened', 'unassigned_payment', 'all_invoices_frozen']
const ALL_STATES = ['open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled']
function transitionAllowed(from: string | null, to: string, cause: string): boolean {
  if (from === null) return to === 'open' && cause === 'import'
  if (from === 'settled') return to === 'open' && cause === 'import'
  if (from === 'transferred') return false
  if (from === 'open' && to === 'negotiating') return cause === 'offer_unlocked'
  if (from === 'negotiating' && to === 'committed') return cause === 'commitment_registered'
  if (from === 'committed' && to === 'open') return cause === 'commitment_broken' || cause === 'commitment_held'
  if (from === 'committed' && to === 'settled') return cause === 'commitment_held'
  if (['open', 'negotiating', 'committed', 'supervisor_queue'].includes(from) && to === 'frozen') return FROZEN_CAUSES.includes(cause)
  if (from === 'frozen' && ALL_STATES.includes(to)) return cause === 'freeze_released' || (to === 'settled' && cause === 'balance_cleared') || (to === 'transferred' && cause === 'transfer_approved')
  if (['open', 'negotiating', 'committed'].includes(from) && to === 'supervisor_queue') return cause === 'queue_item_opened'
  if (from === 'supervisor_queue' && ALL_STATES.includes(to)) return cause === 'queue_item_decided' || (to === 'transferred' && cause === 'transfer_approved') || (to === 'settled' && cause === 'balance_cleared')
  if (['supervisor_queue', 'open', 'negotiating', 'committed'].includes(from) && to === 'transferred') return cause === 'transfer_approved'
  if (['open', 'negotiating', 'committed', 'frozen', 'supervisor_queue'].includes(from) && to === 'settled') return cause === 'balance_cleared'
  return false
}

describe('Recouvrement - dossiers', () => {
  let w: World
  let sup: string

  beforeEach(async () => {
    await resetData()
    w = new World()
    sup = await w.tok('sup')
    w.sup = await w.acc('sup')
  })
  afterAll(async () => {
    await closePool()
  })

  const PORTFOLIO: Inv[] = [
    { numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 30, entite: SIREN_A },
    { numero: 'FA-002', debiteur: 'D2', montant: 50000, late: 10, entite: SIREN_B, nature: 'entreprise', segment: 'premium' },
    { numero: 'FA-003', debiteur: 'D3', montant: 70000, late: 45, entite: SIREN_A, segment: 'premium' },
    { numero: 'FA-004', debiteur: 'D_X', montant: 10000, late: 5, entite: SIREN_A },
    { numero: 'FA-005', debiteur: 'DAX', montant: 20000, late: 5, entite: SIREN_B },
    { numero: 'FA-006', debiteur: 'R%1', montant: 30000, late: 5, entite: SIREN_A },
  ]

  /** Assertion du référentiel sur l'historique de tous les dossiers. */
  async function expectHistoriesInReferential() {
    const cases = ok(await get('/cases?size=100', sup)).items
    for (const c of cases) {
      const history = ok(await get(`/cases/${c.id}/state-history?size=100`, sup)).items
      for (const h of history) {
        if (!transitionAllowed(h.from, h.to, h.cause)) throw new Error(`transition hors référentiel pour ${c.debtorId} : ${JSON.stringify(h)}`)
      }
    }
  }

  describe('GET /cases', () => {
    beforeEach(async () => {
      await setupWorld({ invoices: PORTFOLIO }, w)
    })

    it('[rule-recouvrement-cases-supervisor-only][rule-recouvrement-debtor-attributes] each summary carries the identifier, nature, segment, creditor SIRENs, state, amounts, delay and update instant', async () => {
      const res = await get('/cases?size=100', sup)
      expectRes(res, 200)
      expect(res.body.total).toBe(6)
      for (const c of res.body.items) expect(Object.keys(c).sort()).toEqual(SUMMARY_KEYS)
      const d1 = res.body.items.find((c: any) => c.debtorId === 'D1')
      expect(d1).toMatchObject({
        nature: 'family', segment: 'standard', creditors: [SIREN_A], state: 'open', negotiableCents: 100000, openBalanceCents: 100000, openInvoices: 1, maxDaysLate: 30,
      })
      const d2 = res.body.items.find((c: any) => c.debtorId === 'D2')
      expect(d2).toMatchObject({ nature: 'company', segment: 'premium', creditors: [SIREN_B] })
    })

    it('[rule-recouvrement-cases-supervisor-only] cases are sorted by negotiable amount descending then by customer id; the page and the total follow from and size', async () => {
      const res = await get('/cases?size=100', sup)
      expect(res.body.items.map((c: any) => c.debtorId)).toEqual(['D1', 'D3', 'D2', 'R%1', 'DAX', 'D_X'])
      const page = await get('/cases?from=2&size=2', sup)
      expect(page.body.total).toBe(6)
      expect(page.body.items.map((c: any) => c.debtorId)).toEqual(['D2', 'R%1'])
      expect((await get('/cases?from=100', sup)).body.items).toEqual([])
      expect((await get('/cases', sup)).body.items).toHaveLength(6)
    })

    it('[rule-recouvrement-cases-supervisor-only] filters by state, nature, segment and creditor SIREN, combinable', async () => {
      const ids = async (q: string) => (await get(`/cases?size=100&${q}`, sup)).body.items.map((c: any) => c.debtorId)
      expect(await ids('nature=company')).toEqual(['D2'])
      expect(await ids('segment=premium')).toEqual(['D3', 'D2'])
      expect(await ids(`creditor=${SIREN_B}`)).toEqual(['D2', 'DAX'])
      expect(await ids(`creditor=${SIREN_B}&segment=standard`)).toEqual(['DAX'])
      expect(await ids('state=open')).toHaveLength(6)
      expect(await ids('state=frozen')).toEqual([])
      expect(await ids('nature=family&segment=premium&state=open')).toEqual(['D3'])
    })

    it('[rule-recouvrement-cases-supervisor-only] the search is a case-insensitive substring of the customer id, with % and _ taken literally', async () => {
      const ids = async (q: string) => (await get(`/cases?size=100&search=${encodeURIComponent(q)}`, sup)).body.items.map((c: any) => c.debtorId)
      expect(await ids('d3')).toEqual(['D3'])
      expect(await ids('_')).toEqual(['D_X'])
      expect(await ids('%')).toEqual(['R%1'])
      expect(await ids('AX')).toEqual(['DAX', 'D_X'].filter((x) => x.includes('AX') || x.toUpperCase().includes('AX')))
      expect(await ids('zzz')).toEqual([])
    })

    it('[rule-recouvrement-cases-supervisor-only] invalid filters answer 400: unknown state, nature, short creditor, empty or long search, long segment, bad pagination', async () => {
      for (const q of [
        'state=inconnu', 'nature=asso', 'creditor=12345678', 'creditor=abcdefghi', 'search=', `search=${'a'.repeat(51)}`, `segment=${'a'.repeat(51)}`, 'size=0', 'size=101', 'from=-1',
      ]) {
        expectRes(await get(`/cases?${q}`, sup), 400, 'api.validation.incoming_failed')
      }
    })

    it('[rule-recouvrement-cases-supervisor-only] the filters route lists the segments and creditor SIRENs present, sorted and without duplicate', async () => {
      const res = await get('/cases/filters', sup)
      expectRes(res, 200)
      expect(res.body).toEqual({ segments: ['premium', 'standard'], creditors: [SIREN_A, SIREN_B].sort() })
    })
  })

  describe('GET /cases/:id', () => {
    it('[rule-recouvrement-cases-supervisor-only][rule-recouvrement-debtor-attributes] the card carries the invoices with their creditor entity, the freezes, offers, commitments, ledger outputs, open queue items and the active policy', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'DC', montant: 100000, nature: 'entreprise', late: 20 }] }, w)
      const detail = await w.caseDetail('DC')
      expect(Object.keys(detail).sort()).toEqual(DETAIL_KEYS)
      expect(detail).toMatchObject({ debtorSiren: '443061841', nature: 'company', freezes: [], unlockedOffers: [], commitments: [], ledgerOutputs: [], openQueueItems: [] })
      expect(detail.activePolicy).toEqual({ id: w.policyId, label: expect.any(String) })
      const inv = detail.invoices[0]
      expect(Object.keys(inv).sort()).toEqual(INVOICE_KEYS)
      expect(inv).toMatchObject({
        kind: 'invoice', number: 'FA-001', creditorSiren: SIREN_A, amountCents: 100000, balanceCents: 100000, daysLate: 20, frozen: false, freezeCodes: [],
        prescription: 'none', coveredByOutputsCents: 0, negotiable: true,
      })
      expect(inv.dueDate).toBe(D(-20))
    })

    it('[rule-recouvrement-cases-supervisor-only] without an active policy the card has no active policy', async () => {
      await setupWorld({ policy: false, statement: false, contacts: false }, w)
      expect((await w.caseDetail('D1')).activePolicy).toBeNull()
    })

    it('[rule-recouvrement-cases-supervisor-only] an unknown case answers 404 repository.not_found, a malformed id 400, on the card, the decisions and the state history', async () => {
      for (const suffix of ['', '/decisions', '/state-history']) {
        expectRes(await get(`/cases/${UNKNOWN_UUID}${suffix}`, sup), 404, 'repository.not_found')
        expectRes(await get(`/cases/pas-un-uuid${suffix}`, sup), 400, 'api.validation.incoming_failed')
      }
    })
  })

  describe('GET /invoices', () => {
    beforeEach(async () => {
      await setupWorld({
        invoices: [
          { numero: 'FA-100', debiteur: 'D1', montant: 1000 },
          { numero: 'fa-101', debiteur: 'D1', montant: 2000 },
          { numero: 'FA-200', debiteur: 'D2', montant: 3000, solde: 0 },
          { numero: 'AV-100', debiteur: 'D1', montant: -500, type: 'avoir' },
          { numero: 'FA-102', debiteur: 'D2', montant: 4000 },
        ],
      }, w)
    })

    it('[rule-recouvrement-cases-supervisor-only] searches open invoices by number prefix, without regard to case, sorted by number; settled invoices and credit notes are left out', async () => {
      const res = await get('/invoices?number=fa-1&size=100', sup)
      expectRes(res, 200)
      expect(res.body.items.map((i: any) => i.number).sort()).toEqual(['FA-100', 'FA-102', 'fa-101'])
      expect(res.body.total).toBe(3)
      expect(Object.keys(res.body.items[0]).sort()).toEqual(['balanceCents', 'caseId', 'creditorSiren', 'debtorId', 'frozen', 'id', 'number'])
      expect((await get('/invoices?number=FA-2', sup)).body.items).toEqual([])
      expect((await get('/invoices?number=AV', sup)).body.items).toEqual([])
    })

    it('[rule-recouvrement-cases-supervisor-only] the number is required (1 to 50 characters); the pagination is bounded', async () => {
      for (const q of ['', 'number=', `number=${'a'.repeat(51)}`, 'number=F&size=0', 'number=F&size=101']) {
        expectRes(await get(`/invoices?${q}`, sup), 400, 'api.validation.incoming_failed')
      }
      expect((await get(`/invoices?number=${'F'.repeat(50)}`, sup)).status).toBe(200)
    })
  })

  describe('montant négociable', () => {
    it('[rule-recouvrement-negotiable-amount] the negotiable amount is the sum of the balances of the non frozen invoices', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, solde: 70000 }, { numero: 'FA-002', debiteur: 'D1', montant: 50000 }] }, w)
      const c = await w.caseOf('D1')
      expect(c.negotiableCents).toBe(120000)
      expect(c.openBalanceCents).toBe(120000)
      expect(c.openInvoices).toBe(2)
    })

    it('[rule-recouvrement-negotiable-credit-notes][D-0008] the negotiable amount is the sum of the invoices only: an open credit note stays visible on the card and is not deducted', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'AV-001', debiteur: 'D1', montant: -20000, type: 'avoir' }] }, w)
      const res = await get(`/cases/${await w.caseId('D1')}`, sup)
      expect(res.status).toBe(200)
      const detail = res.body.case
      expect(detail.negotiableCents).toBe(100000)
      expect(detail.invoices.find((i: any) => i.number === 'AV-001')).toMatchObject({ kind: 'credit_note', balanceCents: -20000, negotiable: false })
    })

    it('[rule-recouvrement-invoice-dispute-frozen] an invoice in an open dispute is frozen and out of the negotiable amount', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D1', montant: 40000 }] }, w)
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-002', '', 'Litige', 'Service', D(-1)]]))
      const detail = await w.caseDetail('D1')
      expect(detail.negotiableCents).toBe(100000)
      expect(detail.invoices.find((i: any) => i.number === 'FA-002')).toMatchObject({ frozen: true, negotiable: false, freezeCodes: ['dispute'] })
      expect(detail.state).toBe('open')
    })

    it('[rule-recouvrement-prescription] the prescription date is the start date (invoice date or due date, by the policy) plus the delay: out of the negotiable amount from that day, « near » from the alert delay before', async () => {
      const presc = ruleFor('presc', 'family', { limitation: { delayDays: 100, startsFrom: 'due_date', alertDays: 30 } })
      const invoices: Inv[] = [
        { numero: 'P-EXPIRED', debiteur: 'D1', montant: 10000, segment: 'presc', echeance: D(-120) },
        { numero: 'P-TODAY', debiteur: 'D2', montant: 20000, segment: 'presc', echeance: D(-100) },
        { numero: 'P-NEAR', debiteur: 'D3', montant: 30000, segment: 'presc', echeance: D(-70) },
        { numero: 'P-NEAR-FAR', debiteur: 'D4', montant: 40000, segment: 'presc', echeance: D(-69) },
        { numero: 'P-FINE', debiteur: 'D5', montant: 50000, segment: 'presc', echeance: D(-10) },
      ]
      await setupWorld({ invoices, policy: { extraRules: [presc] } }, w)
      expectRes(await w.prepareBatch(), 201)
      const flag = async (debtor: string) => (await w.caseDetail(debtor)).invoices[0]
      expect(await flag('D1')).toMatchObject({ prescription: 'expired', prescriptionDate: D(-20), negotiable: false })
      expect(await flag('D2')).toMatchObject({ prescription: 'expired', prescriptionDate: D(0) })
      expect(await flag('D3')).toMatchObject({ prescription: 'near', prescriptionDate: D(30), negotiable: true })
      expect(await flag('D4')).toMatchObject({ prescription: 'none', prescriptionDate: D(31) })
      expect(await flag('D5')).toMatchObject({ prescription: 'none' })
      expect((await w.caseDetail('D1')).negotiableCents).toBe(0)
      expect((await w.caseDetail('D3')).negotiableCents).toBe(30000)
    })

    it('[rule-recouvrement-prescription][rule-recouvrement-batch-prescription-flow] the batch preparation opens one « prescription échue » item per expired invoice and one « prescription proche » item (with the proposed next step) per invoice near; a second preparation opens no duplicate', async () => {
      const presc = ruleFor('presc', 'family', { limitation: { delayDays: 100, startsFrom: 'invoice_date', alertDays: 30 } })
      const invoices: Inv[] = [
        { numero: 'P-1', debiteur: 'D1', montant: 10000, segment: 'presc', dateFacture: D(-120), echeance: D(-90) },
        { numero: 'P-2', debiteur: 'D1', montant: 10000, segment: 'presc', dateFacture: D(-130), echeance: D(-90) },
        { numero: 'P-3', debiteur: 'D2', montant: 20000, segment: 'presc', dateFacture: D(-75), echeance: D(-45) },
      ]
      await setupWorld({ invoices, policy: { extraRules: [presc] }, statement: false }, w)
      expectRes(await w.prepareBatch(), 201)
      expectRes(await w.prepareBatch(), 201)
      const counts = await w.queueCounts()
      expect(counts.byType).toMatchObject({ prescription_expired: 2, prescription_near: 1 })
      const near = (await w.queueItems('&type=prescription_near'))[0]
      expect(near.status).toBe('open')
      expect(JSON.stringify(near.details)).toMatch(/Recouvreur externe/)
      expect(near.allowedDecisions.sort()).toEqual(['acknowledge', 'transfer'])
      const expired = await w.queueItems('&type=prescription_expired')
      expect(expired.map((i: any) => i.debtorId)).toEqual(['D1', 'D1'])
    })

    it('[rule-recouvrement-case-state-queue-types][D-0016] a near prescription item does not put the case in the supervisor queue: the case stays open, the item is listed on the card', async () => {
      const presc = ruleFor('presc', 'family', { limitation: { delayDays: 100, startsFrom: 'due_date', alertDays: 30 } })
      await setupWorld({ invoices: [{ numero: 'P-1', debiteur: 'D1', montant: 10000, segment: 'presc', echeance: D(-80) }], policy: { extraRules: [presc] } }, w)
      expectRes(await w.prepareBatch(), 201)
      const res = await get(`/cases/${await w.caseId('D1')}`, sup)
      expect(res.status).toBe(200)
      const detail = res.body.case
      expect(detail.state).toBe('open')
      expect(detail.openQueueItems).toEqual([expect.objectContaining({ type: 'prescription_near' })])
    })

    it('[rule-recouvrement-amount-threshold] a negotiable amount above the threshold of the rule stops the negotiation: one item « montant au-delà du seuil », the case in the supervisor queue, a journal decision of kind threshold', async () => {
      const gros = ruleFor('gros', 'family', { thresholdCents: 50000 })
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 50001, segment: 'gros' }, { numero: 'FA-002', debiteur: 'D2', montant: 50000, segment: 'gros' }], policy: { extraRules: [gros] } }, w)
      expectRes(await w.prepareBatch(), 201)
      expectRes(await w.prepareBatch(), 201)
      const items = await w.queueItems('&type=amount_over_threshold')
      expect(items).toHaveLength(1)
      expect(items[0].debtorId).toBe('D1')
      expect(items[0].allowedDecisions.sort()).toEqual(['authorize', 'transfer'])
      expect((await w.caseDetail('D1')).state).toBe('supervisor_queue')
      expect((await w.caseDetail('D2')).state).toBe('open')
      const decisions = ok(await get(`/cases/${await w.caseId('D1')}/decisions?size=100`, sup)).items
      expect(decisions.map((d: any) => d.kind)).toContain('threshold')
    })

    it('[rule-recouvrement-amount-threshold][rule-recouvrement-negotiation-stopped] the agent tools answer 409 negotiation.stopped for a case over the threshold, the reading stays possible', async () => {
      const gros = ruleFor('gros', 'family', { thresholdCents: 50000 })
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 50001, segment: 'gros' }], policy: { extraRules: [gros] } }, w)
      const agent = new RestTools(await w.tok('agent'), 'voice')
      const caseId = await w.caseId('D1')
      await openConversation(agent, 'c-1', caseId, await w.contactId('D1'))
      const offer = await agent.nextOffer('c-1', caseId, {})
      expect(offer.status).toBe(409)
      expect(offer.body.code).toBe('negotiation.stopped')
      expect((await agent.read('c-1', caseId)).ok).toBe(true)
    })
  })

  describe('journal des décisions du cerveau', () => {
    it('[rule-recouvrement-decision-journal][rule-recouvrement-batch-brain-decides] a batch journals one decision per case with the complete inputs, the policy version, the rule applied and the probability 1', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, late: 50, nature: 'entreprise' }] }, w)
      const batch = ok(await w.prepareBatch()).batch
      const caseId = await w.caseId('D1')
      const res = await get(`/cases/${caseId}/decisions?size=100`, sup)
      expectRes(res, 200)
      const daily = res.body.items.filter((d: any) => d.kind === 'daily_action')
      expect(daily).toHaveLength(1)
      expect(daily[0]).toMatchObject({ outcome: 'reminder', ruleId: 'r-reminder', probability: 1, batchId: batch.id, policyVersion: { id: w.policyId } })
      expect(Object.keys(daily[0]).sort()).toEqual(['batchId', 'decidedAt', 'id', 'inputs', 'internalReason', 'kind', 'outcome', 'policyVersion', 'probability', 'ruleId'])
      const inputs = Object.fromEntries(daily[0].inputs.map((i: any) => [i.name, i.value]))
      expect(Object.values(inputs).join(' ')).toMatch(/standard/)
      expect(Object.values(inputs).join(' ')).toMatch(/100000|1000/)
      expect(daily[0].inputs.length).toBeGreaterThanOrEqual(5)
      for (const i of daily[0].inputs) {
        expect(i.name.length).toBeGreaterThanOrEqual(1)
        expect(typeof i.value).toBe('string')
      }
      expect(Array.isArray(daily[0].internalReason)).toBe(true)
      expect(daily[0].internalReason.length).toBeGreaterThan(0)
      const d2 = ok(await get(`/cases/${await w.caseId('D2')}/decisions?size=100`, sup)).items.find((d: any) => d.kind === 'daily_action')
      expect(d2).toMatchObject({ outcome: 'proposal', ruleId: 'r-proposal' })
    })

    it('[rule-recouvrement-decision-journal] decisions are listed newest first and paginated; the journal is append-only in the database', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }] }, w)
      await w.prepareBatch()
      await w.prepareBatch().catch(() => undefined)
      const caseId = await w.caseId('D1')
      const all = ok(await get(`/cases/${caseId}/decisions?size=100`, sup))
      const dates = all.items.map((d: any) => d.decidedAt)
      expect(dates).toEqual([...dates].sort().reverse())
      expect(ok(await get(`/cases/${caseId}/decisions?size=1`, sup)).items).toHaveLength(1)
      expectRes(await get(`/cases/${caseId}/decisions?size=0`, sup), 400, 'api.validation.incoming_failed')
      const { sql } = await import('./harness')
      await expect(sql("update base.decisions set outcome = 'x' where case_id = $1", [caseId])).rejects.toThrow()
      await expect(sql('delete from base.decisions where case_id = $1', [caseId])).rejects.toThrow()
    })

    it('[rule-recouvrement-internal-reason-private] the internal reason is read by the supervisor only: the litigation service, the indicators reader and the agent get 403 on the decisions of a case', async () => {
      await setupWorld({}, w)
      const caseId = await w.caseId('D1')
      for (const who of ['lit', 'ind', 'agent'] as const) {
        expectRes(await get(`/cases/${caseId}/decisions`, await w.tok(who)), 403, 'security.access_denied')
        expectRes(await get(`/cases/${caseId}`, await w.tok(who)), 403, 'security.access_denied')
      }
    })
  })

  describe('états et transitions', () => {
    it('[rule-recouvrement-state-transitions-logged][rule-recouvrement-case-state-referential] every transition is logged with instant, from, to, cause, actor and reference; newest first; only transitions of the referential exist', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }] }, w)
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-001', '', 'Litige', 'Service', D(-1)]]))
      const caseId = await w.caseId('D1')
      const res = await get(`/cases/${caseId}/state-history`, sup)
      expectRes(res, 200)
      expect(res.body.total).toBe(2)
      const [last, first] = res.body.items
      expect(Object.keys(first).sort()).toEqual(['actor', 'at', 'cause', 'from', 'reference', 'to'])
      expect(first).toMatchObject({ from: null, to: 'open', cause: 'import', actor: 'import' })
      expect(last).toMatchObject({ from: 'open', to: 'frozen' })
      expect(FROZEN_CAUSES).toContain(last.cause)
      expect(last.at >= first.at).toBe(true)
      expect(ok(await get(`/cases/${caseId}/state-history?size=1`, sup)).items).toHaveLength(1)
      await expectHistoriesInReferential()
    })

    it('[rule-recouvrement-case-state-referential] the precedence frozen over supervisor queue over committed over negotiating over open is applied: a case in the queue that receives a freeze is frozen', async () => {
      const gros = ruleFor('gros', 'family', { thresholdCents: 50000 })
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 90000, segment: 'gros' }, { numero: 'FA-002', debiteur: 'D1', montant: 10000, segment: 'gros' }], policy: { extraRules: [gros] } }, w)
      await w.prepareBatch()
      expect((await w.caseDetail('D1')).state).toBe('supervisor_queue')
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-001', '', 'Litige', 'Service', D(-1)], ['FA-002', '', 'Litige', 'Service', D(-1)]]))
      expect((await w.caseDetail('D1')).state).toBe('frozen')
      await expectHistoriesInReferential()
    })

    it('[rule-recouvrement-case-state-referential] a case with every open invoice frozen is frozen; closing the last dispute gives back the state of precedence (cause freeze_released)', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }] }, w)
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-001', '', 'Litige', 'Service', D(-1)]]))
      expect((await w.caseDetail('D1')).state).toBe('frozen')
      const lit = await w.tok('lit')
      const dispute = ok(await get('/disputes', lit)).items[0]
      expectRes(await (await import('./recouvrement-helpers')).post(`/disputes/${dispute.id}/close`, lit, { note: 'Réglé avec le client' }), 200)
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('open')
      const history = ok(await get(`/cases/${detail.id}/state-history`, sup)).items
      expect(history[0]).toMatchObject({ from: 'frozen', to: 'open', cause: 'freeze_released' })
      await expectHistoriesInReferential()
    })
  })

  describe('structure du fichier de créances utilisée par les dossiers', () => {
    it('[rule-recouvrement-case-grouping] one case per customer id, whatever the number of rows and creditor entities', async () => {
      const rows: Inv[] = Array.from({ length: 6 }, (_, i) => ({ numero: `FA-${i}`, debiteur: 'D1', montant: 1000 * (i + 1), entite: i % 2 ? SIREN_A : SIREN_B }))
      await importOk(sup, 'receivables', receivablesFile(rows, D(-3)), { controlTotal: euros(receivablesTotal(rows)) })
      const list = ok(await get('/cases', sup))
      expect(list.total).toBe(1)
      expect(list.items[0]).toMatchObject({ debtorId: 'D1', openInvoices: 6, negotiableCents: 21000 })
      expect(RECEIVABLES_HEADER.length).toBe(receivableRow(rows[0], D(-3)).length)
    })
  })
})
