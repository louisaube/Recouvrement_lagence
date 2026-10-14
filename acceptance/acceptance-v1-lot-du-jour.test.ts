import { resetData, closePool, sql } from './harness'
import {
  World, get, post, expectRes, ok, UNKNOWN_UUID, setupWorld, daysFromToday, policyDoc, ruleFor, importOk, strip, DISPUTES_HEADER, DOCUMENTS_HEADER, SIREN_A,
  RestTools, openConversation, descendTo, commitmentFor, moveBatchBack, contactsFile, defaultContact, standardLadder, DEFAULT_DECISION_ROWS, activatePolicy,
} from './recouvrement-helpers'
import type { Inv, ContactRow } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : lot du jour, ordres d'envoi, garde-fous.

const D = (n: number) => daysFromToday(n)
const ORDER_KEYS = ['batchId', 'blockReason', 'caseId', 'channel', 'conditions', 'debtorId', 'id', 'interlocutorId', 'interlocutorRole', 'orderDate', 'status', 'type']
const SUMMARY_KEYS = ['caseCount', 'createdAt', 'date', 'failedChecks', 'id', 'orderCount', 'preparedBy', 'releasedAt', 'releasedBy', 'status']
const DETAIL_KEYS = [...SUMMARY_KEYS, 'checks', 'excluded', 'ordersByType', 'policyVersion', 'releaseReason', 'replacedBy', 'shares'].sort()
const AMOUNT_1000 = /1[  .]?000[,.]00|100000/

describe('Recouvrement - lot du jour', () => {
  let w: World
  let sup: string

  beforeEach(async () => {
    await resetData()
    w = new World()
    sup = await w.tok('sup')
  })
  afterAll(async () => {
    await closePool()
  })

  const prepare = async () => ok(await w.prepareBatch()).batch
  const check = (batch: any, code: string) => batch.checks.find((c: any) => c.code === code)
  const excluded = (batch: any, reason: string) => batch.excluded.find((e: any) => e.reason === reason)?.count ?? 0
  const orders = async (batchId: string, q = '') => ok(await get(`/daily-batches/${batchId}/orders?${/(^|&)size=/.test(q) ? '' : 'size=100'}${q}`.replace('?&', '?'), sup))

  // ------------------------------------------------------------------ accès

  describe('accès', () => {
    it('[rule-recouvrement-batch-prepared-by-supervisor] only the supervisor prepares, reads and releases batches: the other profiles, a plain user and a profile-less admin get 403, without a token 401', async () => {
      await setupWorld({}, w)
      const batch = await prepare()
      const calls: [string, string, unknown?][] = [
        ['GET', '/daily-batches'], ['GET', `/daily-batches/${batch.id}`], ['GET', `/daily-batches/${batch.id}/orders`], ['POST', '/daily-batches'],
        ['POST', `/daily-batches/${batch.id}/release`, { reason: 'ok' }],
      ]
      const { http } = await import('./recouvrement-helpers')
      for (const [method, path, body] of calls) {
        expect([method, path, (await http(method, path, undefined, body)).status]).toEqual([method, path, 401])
        for (const who of ['agent', 'lit', 'ind', 'user', 'admin'] as const) {
          const res = await http(method, path, await w.tok(who), body)
          expect([who, method, path, res.status, res.body?.code]).toEqual([who, method, path, 403, 'security.access_denied'])
        }
      }
      expect((await get('/daily-batches', await w.tok('sup2'))).status).toBe(200)
    })

    it('[rule-recouvrement-batch-prepared-by-supervisor] nothing is prepared by itself: with no call there is no batch', async () => {
      await setupWorld({}, w)
      const res = await get('/daily-batches', sup)
      expect(res.body).toEqual({ items: [], total: 0 })
    })
  })

  // ------------------------------------------------------------------ préparation et libération

  describe('préparation', () => {
    it('[rule-recouvrement-batch-release-mode][D-0020][rule-recouvrement-batch-release-when-checks-pass] when all the checks pass the batch is ready from the preparation, with no releaser; the four checks are passed', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, late: 50 }] }, w)
      const res = await post('/daily-batches', sup)
      expectRes(res, 201)
      const batch = res.body.batch
      expect(Object.keys(batch).sort()).toEqual(DETAIL_KEYS)
      expect(batch).toMatchObject({ status: 'ready', date: D(0), caseCount: 2, orderCount: 2, failedChecks: 0, releasedBy: null, releasedAt: null, releaseReason: null, replacedBy: null })
      expect(batch.preparedBy).toEqual({ id: (await w.acc('sup')).id, email: 'sup@recette.test' })
      expect(batch.policyVersion).toEqual({ id: w.policyId, label: expect.any(String) })
      expect(batch.checks.map((c: any) => c.code).sort()).toEqual(['decision_share', 'no_duplicate_order', 'statement_fresh', 'witnesses_replayed'])
      for (const c of batch.checks) expect(c).toEqual({ code: c.code, status: 'passed', problems: [] })
      expect(batch.ordersByType.sort((a: any, b: any) => a.type.localeCompare(b.type))).toEqual([{ type: 'proposal', count: 1 }, { type: 'reminder', count: 1 }])
    })

    it('[rule-recouvrement-batch-brain-decides] without an active policy the preparation answers 409 batches.no_active_policy and creates nothing', async () => {
      await setupWorld({ policy: false }, w)
      const res = await w.prepareBatch()
      expectRes(res, 409, 'batches.no_active_policy')
      expect((await get('/daily-batches', sup)).body.total).toBe(0)
    })

    it('[rule-recouvrement-batch-brain-decides] the brain decides every non final case and journals each decision; settled and transferred cases are left out', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }, { numero: 'FA-003', debiteur: 'D3', montant: 100000 }] }, w)
      await sql("update base.cases set state = 'settled' where debtor_id = 'D2'")
      await sql("update base.cases set state = 'transferred' where debtor_id = 'D3'")
      const batch = await prepare()
      expect(batch.caseCount).toBe(1)
      const decided = await sql<any>("select count(*)::int as n from base.decisions where kind = 'daily_action'")
      expect(decided[0].n).toBe(1)
      expect(ok(await get(`/cases/${await w.caseId('D2')}/decisions`, sup)).items.filter((d: any) => d.kind === 'daily_action')).toEqual([])
    })

    it('[rule-recouvrement-batch-orders-structured] a reminder carries the amount due and the due date of each invoice, a proposal the conditions of the anchor; orders are structured (case, interlocutor, channel, conditions) and carry no drafted text', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D1', montant: 100000, late: 12 }, { numero: 'FA-003', debiteur: 'D2', montant: 100000, late: 50 }] }, w)
      const batch = await prepare()
      const list = await orders(batch.id)
      expect(list.total).toBe(2)
      const [reminder, proposal] = list.items
      expect(Object.keys(reminder).sort()).toEqual(ORDER_KEYS)
      expect(reminder).toMatchObject({ type: 'reminder', status: 'planned', debtorId: 'D1', channel: 'voice', interlocutorRole: 'payer', orderDate: D(0), batchId: batch.id, blockReason: null })
      expect(reminder.caseId).toBe(await w.caseId('D1'))
      expect(reminder.interlocutorId).toBe(await w.contactId('D1'))
      const text = JSON.stringify(reminder.conditions)
      expect(text).toContain('FA-001')
      expect(text).toContain('FA-002')
      expect(text).toContain(D(-10))
      expect(text).toContain(D(-12))
      expect(text).toMatch(AMOUNT_1000)
      expect(proposal).toMatchObject({ type: 'proposal', debtorId: 'D2' })
      expect(JSON.stringify(proposal.conditions)).toMatch(AMOUNT_1000)
      for (const o of list.items) {
        for (const c of o.conditions) {
          expect(c.name.length).toBeGreaterThanOrEqual(1)
          expect(c.name.length).toBeLessThanOrEqual(100)
          expect(c.value.length).toBeLessThanOrEqual(300)
        }
      }
    })

    it('[rule-recouvrement-batch-orders-structured] orders are sorted by customer id then type, filterable by type and channel and paginated; an unknown batch is 404, a malformed id 400', async () => {
      const invoices: Inv[] = ['D3', 'D1', 'D2', 'D4'].map((d, i) => ({ numero: `FA-00${i}`, debiteur: d, montant: 100000, late: i < 2 ? 10 : 50 }))
      await setupWorld({ invoices }, w)
      const batch = await prepare()
      const all = await orders(batch.id)
      expect(all.items.map((o: any) => o.debtorId)).toEqual(['D1', 'D2', 'D3', 'D4'])
      expect((await orders(batch.id, '&type=reminder')).total).toBe(2)
      expect((await orders(batch.id, '&type=proposal')).items.map((o: any) => o.type)).toEqual(['proposal', 'proposal'])
      expect((await orders(batch.id, '&channel=mail')).total).toBe(0)
      expect((await orders(batch.id, '&channel=voice')).total).toBe(4)
      expect((await orders(batch.id, '&from=1&size=2')).items.map((o: any) => o.debtorId)).toEqual(['D2', 'D3'])
      for (const q of ['&type=autre', '&channel=sms', '&size=0', '&size=101', '&from=-1']) {
        expectRes(await get(`/daily-batches/${batch.id}/orders?${q.slice(1)}`, sup), 400, 'api.validation.incoming_failed')
      }
      expectRes(await get(`/daily-batches/${UNKNOWN_UUID}/orders`, sup), 404, 'repository.not_found')
      expectRes(await get('/daily-batches/pas-un-uuid/orders', sup), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-batch-channel-order] the channel is the first eligible one in the order voice, email_sms, mail, the interlocutor the first by role then by identifier', async () => {
      const contacts: ContactRow[] = [
        defaultContact('D1'),
        { debiteur: 'D2', role: 'payeur', courriel: 'd2@example.test', adresse: '1 rue A 75001 Paris' },
        { debiteur: 'D3', role: 'payeur', adresse: '1 rue A 75001 Paris' },
        { debiteur: 'DC', role: 'valideur', courriel: 'dc-valideur@example.test', telephone: '+33612345679' },
        { debiteur: 'DC', role: 'comptabilite_fournisseurs', courriel: 'dc-compta@example.test', telephone: '+33612345670' },
        { debiteur: 'DC', role: 'acheteur', courriel: 'dc-acheteur@example.test', telephone: '+33612345671' },
      ]
      await setupWorld({
        invoices: ['D1', 'D2', 'D3'].map((d, i) => ({ numero: `FA-00${i}`, debiteur: d, montant: 100000, late: 10 })).concat([{ numero: 'FA-009', debiteur: 'DC', montant: 100000, late: 10, nature: 'entreprise' } as any]),
        contacts,
      }, w)
      const batch = await prepare()
      const byDebtor = Object.fromEntries((await orders(batch.id)).items.map((o: any) => [o.debtorId, o]))
      expect(byDebtor.D1.channel).toBe('voice')
      expect(byDebtor.D2.channel).toBe('email_sms')
      expect(byDebtor.D3.channel).toBe('mail')
      expect(byDebtor.DC.interlocutorRole).toBe('accounts_payable')
    })

    it('[rule-recouvrement-batch-order-eligibility] a channel is used only if a negotiable invoice authorizes it: an invoice open to mail only gives a mail order even when a phone is known', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10, canaux: 'courrier' }] }, w)
      const batch = await prepare()
      expect((await orders(batch.id)).items.map((o: any) => o.channel)).toEqual(['mail'])
    })

    it('[rule-recouvrement-batch-order-eligibility] a case with no reachable interlocutor on an authorized channel is excluded with its reason and does not block the batch; a frozen case or a null negotiable amount gets no order', async () => {
      await setupWorld({
        invoices: [
          { numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, late: 10, canaux: 'courrier' },
          { numero: 'FA-003', debiteur: 'D3', montant: 100000, late: 10 },
        ],
        contacts: [defaultContact('D1'), { debiteur: 'D2', role: 'payeur', courriel: 'd2@example.test', telephone: '+33612345678' }, defaultContact('D3')],
      }, w)
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-003', '', 'Litige', 'Service', D(-1)]]))
      const batch = await prepare()
      expect(batch.status).toBe('ready')
      expect((await orders(batch.id)).items.map((o: any) => o.debtorId)).toEqual(['D1'])
      expect(excluded(batch, 'no_contact') + excluded(batch, 'channel_not_authorized')).toBe(1)
      expect(excluded(batch, 'frozen')).toBe(1)
      for (const e of batch.excluded) {
        expect(['documents_missing', 'channel_suspended', 'channel_not_authorized', 'no_contact', 'frozen', 'statement_stale', 'covered_by_outputs']).toContain(e.reason)
        expect(Number.isInteger(e.count)).toBe(true)
      }
    })

    it('[rule-recouvrement-documents-required-blocks-reminder][rule-recouvrement-batch-order-eligibility] a document required by the policy and missing from the index excludes the invoice from the reminder; the case is excluded as documents_missing when no invoice is left, and it is ordered once the document is indexed', async () => {
      const exigeant = ruleFor('standard', 'family', { requiredDocuments: ['contract'] })
      await setupWorld({
        invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, late: 10 }],
        policy: { extraRules: [exigeant] },
        documents: [{ numero: 'FA-002', type: 'contrat', reference: 'CT-2' }],
      }, w)
      const batch = await prepare()
      expect((await orders(batch.id)).items.map((o: any) => o.debtorId)).toEqual(['D2'])
      expect(excluded(batch, 'documents_missing')).toBe(1)
      // Le lot ci-dessus est prêt : un seul lot actif par jour (rule-recouvrement-batch-one-per-day), on repart donc d'un monde neuf
      // où le document manquant est indexé avant la préparation.
      await resetData()
      w = new World()
      sup = await w.tok('sup')
      await setupWorld({
        invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, late: 10 }],
        policy: { extraRules: [exigeant] },
        documents: [{ numero: 'FA-002', type: 'contrat', reference: 'CT-2' }],
      }, w)
      await importOk(sup, 'documents', strip([DOCUMENTS_HEADER, ['FA-001', SIREN_A, 'contrat', 'CT-1'], ['FA-002', SIREN_A, 'contrat', 'CT-2']]))
      const indexed = await prepare()
      expect(excluded(indexed, 'documents_missing')).toBe(0)
      expect((await orders(indexed.id)).items.map((o: any) => o.debtorId)).toEqual(['D1', 'D2'])
    })

    it('[rule-recouvrement-batch-statement-fresh] without a fresh bank statement the batch is blocked with no order, every case excluded statement_stale and the check failed with its problems in French', async () => {
      await setupWorld({ statement: false, invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000, late: 10 }] }, w)
      const batch = await prepare()
      expect(batch).toMatchObject({ status: 'blocked', orderCount: 0, failedChecks: 1 })
      expect(excluded(batch, 'statement_stale')).toBe(2)
      const c = check(batch, 'statement_fresh')
      expect(c.status).toBe('failed')
      expect(c.problems.length).toBeGreaterThanOrEqual(1)
      for (const p of c.problems) expect(p.length).toBeLessThanOrEqual(300)
      expect((await orders(batch.id)).total).toBe(0)
    })

    it('[rule-recouvrement-batch-witnesses-replayed][rule-recouvrement-witness-no-order] the witnesses are replayed at each batch without creating an order, a decision on a real case, a queue item or a transition', async () => {
      await setupWorld({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }] }, w)
      const before = {
        transitions: (await sql<any>('select count(*)::int as n from base.case_state_history'))[0].n,
        items: (await sql<any>('select count(*)::int as n from base.queue_items'))[0].n,
      }
      const batch = await prepare()
      expect(check(batch, 'witnesses_replayed')).toEqual({ code: 'witnesses_replayed', status: 'passed', problems: [] })
      expect((await sql<any>("select count(*)::int as n from base.decisions where kind = 'daily_action'"))[0].n).toBe(1)
      expect((await sql<any>('select count(*)::int as n from base.send_orders'))[0].n).toBe(1)
      expect((await sql<any>('select count(*)::int as n from base.queue_items'))[0].n).toBe(before.items)
      expect((await sql<any>('select count(*)::int as n from base.case_state_history'))[0].n).toBe(before.transitions)
    })
  })

  // ------------------------------------------------------------------ un lot par jour, remplacement, libération

  describe('remplacement et libération', () => {
    it('[rule-recouvrement-batch-one-per-day] a second preparation the same day replaces a blocked batch: it becomes replaced, its orders cancelled and replacedBy set; the new one comes first in the list', async () => {
      await setupWorld({ statement: false }, w)
      const first = await prepare()
      expect(first.status).toBe('blocked')
      await importOk(sup, 'payments', (await import('./recouvrement-helpers')).paymentsFile([{ reference: 'R-1', montant: 100, date: D(-6) }], D(0)))
      const second = await prepare()
      expect(second.status).toBe('ready')
      const old = ok(await get(`/daily-batches/${first.id}`, sup)).batch
      expect(old).toMatchObject({ status: 'replaced', replacedBy: second.id })
      expect((await orders(first.id)).items.every((o: any) => o.status === 'cancelled')).toBe(true)
      const list = ok(await get('/daily-batches', sup))
      expect(list.items.map((b: any) => b.id)).toEqual([second.id, first.id])
      expect(list.total).toBe(2)
      expect(Object.keys(list.items[0]).sort()).toEqual(SUMMARY_KEYS)
    })

    it('[rule-recouvrement-batch-one-per-day] when the batch of the day is ready a new preparation answers 409 batches.already_released and changes nothing', async () => {
      await setupWorld({}, w)
      const first = await prepare()
      expectRes(await w.prepareBatch(), 409, 'batches.already_released')
      expect(ok(await get('/daily-batches', sup)).total).toBe(1)
      expect(ok(await get(`/daily-batches/${first.id}`, sup)).batch.status).toBe('ready')
    })

    it('[rule-recouvrement-batch-blocked-release-by-decision] a blocked batch is released only by a reasoned decision: it becomes ready, keeps the releaser, the reason and its failed checks', async () => {
      await setupWorld({ statement: false }, w)
      const blocked = await prepare()
      const res = await post(`/daily-batches/${blocked.id}/release`, sup, { reason: '  Relevé vérifié à la main  ' })
      expectRes(res, 200)
      expect(res.body.batch).toMatchObject({ status: 'ready', releaseReason: 'Relevé vérifié à la main', releasedBy: { id: (await w.acc('sup')).id, email: 'sup@recette.test' } })
      expect(res.body.batch.releasedAt).not.toBeNull()
      expect(check(res.body.batch, 'statement_fresh').status).toBe('failed')
      expect(res.body.batch.failedChecks).toBe(1)
    })

    it('[rule-recouvrement-batch-blocked-release-by-decision] the reason is required (1 to 1000 characters after trimming), the body strict, the id a uuid; an unknown batch is 404; a batch that is not blocked answers 409 batches.not_releasable', async () => {
      await setupWorld({ statement: false }, w)
      const blocked = await prepare()
      for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'r'.repeat(1001) }, { reason: 'ok', extra: 1 }, { reason: 5 }]) {
        expectRes(await post(`/daily-batches/${blocked.id}/release`, sup, body), 400, 'api.validation.incoming_failed')
      }
      expectRes(await post('/daily-batches/pas-un-uuid/release', sup, { reason: 'ok' }), 400, 'api.validation.incoming_failed')
      expectRes(await post(`/daily-batches/${UNKNOWN_UUID}/release`, sup, { reason: 'ok' }), 404, 'repository.not_found')
      expect(ok(await get(`/daily-batches/${blocked.id}`, sup)).batch.status).toBe('blocked')
      expectRes(await post(`/daily-batches/${blocked.id}/release`, sup, { reason: 'r'.repeat(1000) }), 200)
      expectRes(await post(`/daily-batches/${blocked.id}/release`, sup, { reason: 'encore' }), 409, 'batches.not_releasable')
    })

    it('[rule-recouvrement-batch-release-when-checks-pass][rule-recouvrement-batch-blocked-release-by-decision] a ready batch and a replaced batch cannot be released: 409 batches.not_releasable', async () => {
      await setupWorld({ statement: false }, w)
      const first = await prepare()
      await importOk(sup, 'payments', (await import('./recouvrement-helpers')).paymentsFile([{ reference: 'R-1', montant: 100, date: D(-6) }], D(0)))
      const second = await prepare()
      expectRes(await post(`/daily-batches/${second.id}/release`, sup, { reason: 'x' }), 409, 'batches.not_releasable')
      expectRes(await post(`/daily-batches/${first.id}/release`, sup, { reason: 'x' }), 409, 'batches.not_releasable')
    })

    it('[rule-recouvrement-batch-no-duplicate-order] a case has one active order per type and day: after a replacement the active orders are one per case and the check no_duplicate_order is passed', async () => {
      await setupWorld({ statement: false, invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 10 }] }, w)
      await prepare()
      await importOk(sup, 'payments', (await import('./recouvrement-helpers')).paymentsFile([{ reference: 'R-1', montant: 100, date: D(-6) }], D(0)))
      const second = await prepare()
      expect(check(second, 'no_duplicate_order')).toEqual({ code: 'no_duplicate_order', status: 'passed', problems: [] })
      const active = await sql<any>("select count(*)::int as n from base.send_orders where status <> 'cancelled' and order_date = current_date")
      expect(active[0].n).toBe(1)
    })

    it('[rule-recouvrement-batch-prepared-by-supervisor] preparation and release are traced in the audit journal with the batch object type, the actions and their summaries', async () => {
      await setupWorld({ statement: false }, w)
      const blocked = await prepare()
      await post(`/daily-batches/${blocked.id}/release`, sup, { reason: 'Décision du superviseur' })
      const log = await get('/audit-logs?size=100', sup)
      const prepared = log.body.entries.find((e: any) => e.action === 'batches:prepare')
      const released = log.body.entries.find((e: any) => e.action === 'batches:release')
      expect(prepared).toBeDefined()
      expect(released).toBeDefined()
      expect(prepared.summary).toMatch(/^Lot du jour du \d{2}\/\d{2}\/\d{4} préparé : \d+ ordres?, bloqué\.$/)
      expect(released.summary).toMatch(/^Lot du jour du \d{2}\/\d{2}\/\d{4} libéré par décision du superviseur\.$/)
      expect(JSON.stringify(log.body.entries)).not.toContain('Décision du superviseur')
    })
  })

  // ------------------------------------------------------------------ transfert proposé

  describe('transfert proposé', () => {
    const delayed: Inv[] = [
      { numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 120 },
      { numero: 'FA-002', debiteur: 'DC', montant: 100000, late: 120, nature: 'entreprise' },
    ]

    it('[rule-recouvrement-company-transfer-proposed][D-0003][rule-recouvrement-batch-families-no-transfer][rule-recouvrement-family-transfer-never-executed] the transfer of a company is proposed to the supervisor like the one of a family: the case is in the supervisor queue with an open transfer_proposed item, never transferred by the brain', async () => {
      await setupWorld({ invoices: delayed }, w)
      expectRes(await post('/daily-batches', sup), 201)
      for (const debtor of ['D1', 'DC']) {
        expect((await w.caseDetail(debtor)).state).toBe('supervisor_queue')
      }
      const items = await w.queueItems('&type=transfer_proposed')
      expect(items.map((i: any) => i.debtorId).sort()).toEqual(['D1', 'DC'])
      expect(items[0].allowedDecisions.sort()).toEqual(['approve_transfer', 'reject_transfer'])
      expect((await sql<any>("select count(*)::int as n from base.cases where state = 'transferred'"))[0].n).toBe(0)
    })

    it('[rule-recouvrement-company-transfer-proposed] a second preparation does not open a second item for the same case (a single open item per type and object)', async () => {
      await setupWorld({ invoices: delayed, statement: false }, w)
      await prepare()
      await importOk(sup, 'payments', (await import('./recouvrement-helpers')).paymentsFile([{ reference: 'R-1', montant: 100, date: D(-6) }], D(0)))
      await prepare()
      expect((await w.queueCounts()).byType.transfer_proposed).toBeLessThanOrEqual(2)
    })
  })

  // ------------------------------------------------------------------ arrêt automatique

  describe('arrêt automatique', () => {
    const caps = (reminder: number) => ({ none: 10000, reminder, proposal: 10000, transfer_proposed: 10000 })

    it('[rule-recouvrement-batch-auto-stop] before ten previous batches the fixed cap of the type applies: a share strictly above the cap blocks the batch, a share equal to the cap does not; a block opens one alert item', async () => {
      const invoices: Inv[] = [1, 2, 3, 4].map((i) => ({ numero: `FA-00${i}`, debiteur: `D${i}`, montant: 100000, late: i <= 2 ? 10 : 0 }))
      await setupWorld({ invoices, policy: { global: { decisionTypeCapsBp: caps(5000) } } }, w)
      const equal = await prepare()
      expect(equal.status).toBe('ready')
      const reminder = equal.shares.find((s: any) => s.type === 'reminder')
      expect(reminder).toMatchObject({ count: 2, shareBp: 5000, mode: 'fixed_cap', capBp: 5000, exceeded: false })
      expect(reminder.meanBp).toBeNull()
      await sql('update base.invoices set due_date = $1 where number in ($2, $3, $4)', [D(-10), 'FA-001', 'FA-002', 'FA-003'])
      await sql("update base.daily_batches set status = 'blocked'")
      const over = await prepare()
      expect(over.status).toBe('blocked')
      const share = over.shares.find((s: any) => s.type === 'reminder')
      expect(share).toMatchObject({ count: 3, shareBp: 7500, mode: 'fixed_cap', capBp: 5000, exceeded: true })
      expect(check(over, 'decision_share').status).toBe('failed')
      expect(check(over, 'decision_share').problems.length).toBeGreaterThanOrEqual(1)
      expect((await w.queueCounts()).byType.alert).toBe(1)
      expect(over.shares.map((s: any) => s.type).sort()).toEqual(['none', 'proposal', 'reminder', 'transfer_proposed'])
      for (const s of over.shares) {
        expect(s.shareBp).toBeGreaterThanOrEqual(0)
        expect(s.shareBp).toBeLessThanOrEqual(10000)
      }
    })

    it('[rule-recouvrement-batch-auto-stop][rule-recouvrement-decision-share-sigma][D-0005] with ten previous batches at 40 % and 60 % of reminders alternately, a batch at 81 % is blocked: population standard deviation of 10 points, threshold of 30 points, gap of 31', async () => {
      const N = 100
      const invoices: Inv[] = Array.from({ length: N }, (_, i) => ({ numero: `FA-${String(i).padStart(3, '0')}`, debiteur: `D${String(i).padStart(3, '0')}`, montant: 10000, late: 0 }))
      await setupWorld({ invoices }, w)
      const setReminders = (k: number) => sql(
        "update base.invoices set due_date = case when substring(number from 4)::int < $1 then current_date - 5 else current_date end",
        [k],
      )
      for (let i = 0; i < 10; i++) {
        await setReminders(i % 2 === 0 ? 40 : 60)
        const batch = await prepare()
        expect(batch.status).toBe('ready')
        await moveBatchBack(batch.id, 10 - i)
      }
      await setReminders(81)
      const todayRes = await post('/daily-batches', sup)
      expectRes(todayRes, 201)
      const today = todayRes.body.batch
      expect(today.status).toBe('blocked')
      const reminder = today.shares.find((s: any) => s.type === 'reminder')
      expect(reminder).toMatchObject({ count: 81, shareBp: 8100, mode: 'statistical', exceeded: true })
      expect(reminder.meanBp).toBeCloseTo(5000, 0)
      expect(reminder.sigmaBp).toBeCloseTo(1000, 0)
      expect(reminder.thresholdBp).toBeCloseTo(3000, 0)
      expect(check(today, 'decision_share').status).toBe('failed')
      expect((await w.queueCounts()).byType.alert).toBe(1)
      const calm = today.shares.find((s: any) => s.type === 'proposal')
      expect(calm).toMatchObject({ mode: 'statistical', exceeded: false })
    }, 600_000)

    it('[rule-recouvrement-batch-auto-stop] with a gap within three standard deviations the batch passes in statistical mode', async () => {
      const N = 100
      const invoices: Inv[] = Array.from({ length: N }, (_, i) => ({ numero: `FA-${String(i).padStart(3, '0')}`, debiteur: `D${String(i).padStart(3, '0')}`, montant: 10000, late: 0 }))
      await setupWorld({ invoices }, w)
      const setReminders = (k: number) => sql(
        "update base.invoices set due_date = case when substring(number from 4)::int < $1 then current_date - 5 else current_date end",
        [k],
      )
      for (let i = 0; i < 10; i++) {
        await setReminders(i % 2 === 0 ? 40 : 60)
        await moveBatchBack((await prepare()).id, 10 - i)
      }
      await setReminders(79)
      const today = await prepare()
      expect(today.status).toBe('ready')
      expect(today.shares.find((s: any) => s.type === 'reminder')).toMatchObject({ mode: 'statistical', exceeded: false })
    }, 600_000)
  })

  // ------------------------------------------------------------------ plafond d'encours et confirmations

  describe('plafond d\'encours et confirmation d\'engagement', () => {
    it('[rule-recouvrement-exposure-ceiling] when the ceiling of the agent version and segment is reached an alert item opens, once while the ceiling stays reached', async () => {
      await setupWorld({
        invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }],
        policy: { global: { exposureCeilings: [{ agentVersion: 'agent-1.0', segment: 'standard', maxCents: 82000 }] } },
      }, w)
      const agent = new RestTools(await w.tok('agent'), 'voice')
      const caseId = await w.caseId('D1')
      await openConversation(agent, 'c-1', caseId, await w.contactId('D1'))
      const offer = await descendTo(agent, 'c-1', caseId, 4)
      expect((await agent.commit('c-1', caseId, commitmentFor(offer))).status).toBe(201)
      await prepare()
      expect((await w.queueCounts()).byType.alert).toBe(1)
      await sql("update base.daily_batches set status = 'blocked'")
      await prepare()
      expect((await w.queueCounts()).byType.alert).toBe(1)
    })

    it('[rule-recouvrement-commitment-confirmation-immediate] a commitment emits at once a confirmation order outside any batch, planned, on an authorized and reachable channel', async () => {
      await setupWorld({}, w)
      const agent = new RestTools(await w.tok('agent'), 'voice')
      const caseId = await w.caseId('D1')
      await openConversation(agent, 'c-1', caseId, await w.contactId('D1'))
      const offer = await descendTo(agent, 'c-1', caseId, 1)
      const res = await agent.commit('c-1', caseId, commitmentFor(offer))
      expect(res.body.confirmationOrder.status).toBe('planned')
      const rows = await sql<any>("select * from base.send_orders where kind = 'commitment_confirmation'")
      expect(rows).toHaveLength(1)
      expect(rows[0].batch_id).toBeNull()
      expect(rows[0].id).toBe(res.body.confirmationOrder.id)
    })
  })

  // ------------------------------------------------------------------ lecture

  describe('lecture', () => {
    it('[rule-recouvrement-batch-prepared-by-supervisor] the list is paginated (from, size 1 to 100), newest date first, and the detail of an unknown batch is 404', async () => {
      await setupWorld({}, w)
      const batch = await prepare()
      await moveBatchBack(batch.id, 1)
      const today = await prepare()
      await moveBatchBack(today.id, 2)
      const list = ok(await get('/daily-batches?size=1', sup))
      expect(list.total).toBe(2)
      expect(list.items).toHaveLength(1)
      expect(list.items[0].id).toBe(batch.id)
      expect(ok(await get('/daily-batches?from=1&size=1', sup)).items[0].id).toBe(today.id)
      for (const q of ['size=0', 'size=101', 'from=-1']) expectRes(await get(`/daily-batches?${q}`, sup), 400, 'api.validation.incoming_failed')
      expectRes(await get(`/daily-batches/${UNKNOWN_UUID}`, sup), 404, 'repository.not_found')
      expectRes(await get('/daily-batches/x', sup), 400, 'api.validation.incoming_failed')
    })
  })
})
