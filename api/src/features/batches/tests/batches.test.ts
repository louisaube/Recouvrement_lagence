import { closePool, createUser, login, resetData, sql } from '../../../platform/testing/helpers'
import { addDays } from '../../cases/clock.service'
import { csv } from '../../imports/tests/files'
import {
  accountWithProfile,
  get,
  importReceivables,
  policyFile,
  post,
  ReceivableLine,
  receivablesCsv,
  today,
  UNKNOWN,
  upload,
} from '../../recovery-common/tests/support'

// Lot du jour: preparation, checks, orders, release.

const D = (n: number) => addDays(today(), n)
const euros = (n: number) => `${n},00`

interface WorldOptions {
  lines?: (ReceivableLine & { late?: number })[]
  policy?: Record<string, unknown> | false
  statement?: boolean
  contacts?: boolean
}

const line = (numero: string, debtor: string, late: number, extra: Partial<ReceivableLine> = {}): ReceivableLine => ({
  numero,
  debtor,
  echeance: D(-late),
  montant: euros(1000),
  ...extra,
})

describe('daily batches routes', () => {
  let sup: string
  let lit: string

  const statementFile = (date: string = today()) =>
    csv([['reference', 'montant', 'date_paiement', 'date_releve'], ['RELEVE-INITIAL', '1,00', D(-5), date]])

  async function importOf(type: string, content: Buffer, token: string = sup) {
    const pre = await (await upload(`/recovery-imports/${type}/preview`, content, token)).json()
    const res = await post(`/recovery-imports/${type}/${pre.importId}/confirm`, token)
    expect(res.status).toBe(200)
  }

  async function activatePolicy(doc: Record<string, unknown>) {
    const pre = await (await upload('/policy-versions/previews', JSON.stringify(doc), sup, 'politique.json')).json()
    expect(pre.valid).toBe(true)
    const confirmed = await (await post(`/policy-versions/previews/${pre.previewId}/confirm`, sup)).json()
    const activated = await post(`/policy-versions/${confirmed.version.id}/activate`, sup)
    expect(activated.status).toBe(200)
    return confirmed.version.id as string
  }

  async function world(options: WorldOptions = {}) {
    const lines = options.lines ?? [line('FA-001', 'D1', 10)]
    await importReceivables(sup, receivablesCsv(lines), euros(1000 * lines.length))
    if (options.policy !== false) await activatePolicy(options.policy ?? policyFile())
    if (options.statement !== false) await importOf('payments', statementFile())
    if (options.contacts !== false) {
      for (const debtor of new Set(lines.map((l) => l.debtor))) await addContact(debtor, { phone: '+33612345678', email: `${debtor}@example.test` })
    }
  }

  async function addContact(debtor: string, c: { role?: string; email?: string | null; phone?: string | null; address?: string | null; suspended?: string[] }) {
    await sql(
      `insert into base.contacts (case_id, role, email, phone, postal_address, suspended_channels)
       select id, $2, $3, $4, $5, $6::text[] from base.cases where debtor_id = $1`,
      [debtor, c.role ?? 'payer', c.email ?? null, c.phone ?? null, c.address ?? null, c.suspended ?? []],
    )
  }

  const prepare = async () => {
    const res = await post('/daily-batches', sup)
    expect(res.status).toBe(201)
    return (await res.json()).batch
  }
  const orders = async (id: string, query = '') => (await (await get(`/daily-batches/${id}/orders?${query}`, sup)).json()) as { items: any[]; total: number }
  const check = (batch: any, code: string) => batch.checks.find((c: any) => c.code === code)

  beforeEach(async () => {
    await resetData()
    sup = (await accountWithProfile('sup@example.com', 'supervisor')).token
    lit = (await accountWithProfile('lit@example.com', 'litigation')).token
  })
  afterAll(closePool)

  describe('access', () => {
    it('[rule-recouvrement-batch-prepared-by-supervisor] anonymous 401, other profiles, plain user and profile-less admin 403 before any validation', async () => {
      await world()
      const batch = await prepare()
      const agent = (await accountWithProfile('agent@example.com', 'agent', 'voice')).token
      const ind = (await accountWithProfile('ind@example.com', 'indicators')).token
      const plain = (await accountWithProfile('plain@example.com', null)).token
      const admin = await (async () => {
        await createUser({ email: 'admin@example.com', role: 'admin' })
        return login('admin@example.com')
      })()
      const calls: [string, string, unknown?][] = [
        ['GET', '/daily-batches'],
        ['GET', `/daily-batches/${batch.id}`],
        ['GET', `/daily-batches/${batch.id}/orders`],
        ['POST', '/daily-batches'],
        ['POST', `/daily-batches/${batch.id}/release`, { reason: 'ok' }],
        // an invalid body does not change the answer: the guard comes first
        ['POST', `/daily-batches/${batch.id}/release`, { extra: 1 }],
      ]
      const { call } = await import('../../../platform/testing/helpers')
      for (const [method, path, body] of calls) {
        expect([method, path, (await call(path, { method, body })).status]).toEqual([method, path, 401])
        for (const token of [lit, agent, ind, plain, admin]) {
          const res = await call(path, { method, body, headers: { authorization: `Bearer ${token}` } })
          expect([method, path, res.status, (await res.json()).code]).toEqual([method, path, 403, 'security.access_denied'])
        }
      }
    })

    it('[rule-recouvrement-batch-prepared-by-supervisor] nothing is prepared by itself: with no call there is no batch', async () => {
      await world()
      expect(await (await get('/daily-batches', sup)).json()).toEqual({ items: [], total: 0 })
    })
  })

  describe('POST /daily-batches', () => {
    it('[rule-recouvrement-batch-release-mode][rule-recouvrement-batch-release-when-checks-pass][rule-recouvrement-batch-brain-decides] every check passing the batch is ready at once, with no releaser; every case is decided and journaled', async () => {
      await world({ lines: [line('FA-001', 'D1', 10), line('FA-002', 'D2', 50)] })
      const batch = await prepare()
      expect(batch).toMatchObject({ status: 'ready', date: today(), caseCount: 2, orderCount: 2, failedChecks: 0, releasedBy: null, releasedAt: null, releaseReason: null, replacedBy: null })
      expect(batch.checks.map((c: any) => c.code).sort()).toEqual(['decision_share', 'no_duplicate_order', 'statement_fresh', 'witnesses_replayed'])
      for (const c of batch.checks) expect(c).toEqual({ code: c.code, status: 'passed', problems: [] })
      expect(batch.ordersByType.sort((a: any, b: any) => a.type.localeCompare(b.type))).toEqual([{ type: 'proposal', count: 1 }, { type: 'reminder', count: 1 }])
      const decisions = await sql("select outcome, rule_id, batch_id, inputs, internal_reason from base.decisions where kind = 'daily_action' order by outcome")
      expect(decisions.map((d) => [d.outcome, d.rule_id, d.batch_id])).toEqual([
        ['proposal', 'r-proposal', batch.id],
        ['reminder', 'r-reminder', batch.id],
      ])
      expect(decisions[0].inputs.map((i: any) => i.name)).toContain('Montant négociable (centimes)')
    })

    it('[rule-recouvrement-batch-brain-decides] without an active policy the preparation answers 409 batches.no_active_policy and creates nothing', async () => {
      await world({ policy: false })
      const res = await post('/daily-batches', sup)
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('batches.no_active_policy')
      expect(await sql('select 1 from base.daily_batches')).toHaveLength(0)
    })

    it('[rule-recouvrement-batch-brain-decides] settled and transferred cases are left out of the decisions', async () => {
      await world({ lines: [line('FA-001', 'D1', 10), line('FA-002', 'D2', 10), line('FA-003', 'D3', 10)] })
      await sql("update base.cases set state = 'settled' where debtor_id = 'D2'")
      await sql("update base.cases set state = 'transferred' where debtor_id = 'D3'")
      const batch = await prepare()
      expect(batch.caseCount).toBe(1)
      expect(await sql("select 1 from base.decisions where kind = 'daily_action'")).toHaveLength(1)
    })

    it('[rule-recouvrement-batch-orders-structured] a reminder carries the amount due and the due date of each invoice, a proposal the anchor; orders hold name-value pairs only', async () => {
      await world({ lines: [line('FA-001', 'D1', 10), line('FA-002', 'D1', 12), line('FA-003', 'D2', 50)] })
      const batch = await prepare()
      const list = await orders(batch.id)
      expect(list.total).toBe(2)
      const [reminder, proposal] = list.items
      expect(Object.keys(reminder).sort()).toEqual(['batchId', 'blockReason', 'caseId', 'channel', 'conditions', 'debtorId', 'id', 'interlocutorId', 'interlocutorRole', 'orderDate', 'status', 'type'])
      expect(reminder).toMatchObject({ type: 'reminder', status: 'planned', debtorId: 'D1', channel: 'voice', interlocutorRole: 'payer', orderDate: today(), batchId: batch.id, blockReason: null })
      expect(reminder.conditions).toEqual([
        { name: 'Facture FA-002 : montant dû (EUR)', value: '1000,00' },
        { name: 'Facture FA-002 : échéance', value: D(-12) },
        { name: 'Facture FA-001 : montant dû (EUR)', value: '1000,00' },
        { name: 'Facture FA-001 : échéance', value: D(-10) },
      ])
      expect(proposal).toMatchObject({ type: 'proposal', debtorId: 'D2' })
      expect(proposal.conditions).toEqual([
        { name: 'Type d’offre', value: 'Paiement comptant' },
        { name: 'Somme à régler (EUR)', value: '1000,00' },
        { name: 'Remise (EUR)', value: '0,00' },
        { name: 'Premier versement avant le', value: D(7) },
      ])
    })

    it('[rule-recouvrement-batch-channel-order] the channel is the first eligible one in the order voice, email_sms, mail; the interlocutor the first by role then identifier', async () => {
      await world({ lines: ['D1', 'D2', 'D3', 'DC'].map((d, i) => line(`FA-00${i}`, d, 10)), contacts: false })
      await sql("update base.invoices set channels = array['voice', 'email_sms', 'mail']")
      await addContact('D1', { phone: '+33612345678', email: 'd1@example.test', address: '1 rue A 75001 Paris' })
      await addContact('D2', { email: 'd2@example.test', address: '1 rue A 75001 Paris' })
      await addContact('D3', { address: '1 rue A 75001 Paris' })
      await addContact('DC', { role: 'approver', email: 'a@example.test', phone: '+33612345679' })
      await addContact('DC', { role: 'accounts_payable', email: 'c@example.test', phone: '+33612345670' })
      await addContact('DC', { role: 'buyer', email: 'b@example.test', phone: '+33612345671' })
      const batch = await prepare()
      const byDebtor = Object.fromEntries((await orders(batch.id)).items.map((o) => [o.debtorId, o]))
      expect(byDebtor.D1.channel).toBe('voice')
      expect(byDebtor.D2.channel).toBe('email_sms')
      expect(byDebtor.D3.channel).toBe('mail')
      expect(byDebtor.DC.interlocutorRole).toBe('accounts_payable')
    })

    it('[rule-recouvrement-batch-order-eligibility] only a channel an invoice is open to is used; a case with nobody reachable is excluded with its reason and does not block the batch; a frozen case gets no order', async () => {
      await world({ lines: [line('FA-001', 'D1', 10), line('FA-002', 'D2', 10), line('FA-003', 'D3', 10), line('FA-004', 'D4', 10), line('FA-005', 'D5', 10)], contacts: false })
      await sql("update base.invoices set channels = array['voice', 'email_sms', 'mail']")
      await sql("update base.invoices set channels = array['mail'] where number in ('FA-001', 'FA-002')")
      await addContact('D1', { phone: '+33612345678', address: '1 rue A 75001 Paris' })
      await addContact('D2', { phone: '+33612345678' })
      await addContact('D3', { phone: '+33612345678', suspended: ['voice', 'email_sms'] })
      await addContact('D5', { phone: '+33612345678' })
      const [{ id: caseId }] = await sql("select id from base.cases where debtor_id = 'D5'")
      const [{ id: invoiceId }] = await sql("select id from base.invoices where number = 'FA-005'")
      await sql("insert into base.freezes (case_id, code, scope, invoice_id, source_type, source_id, reference) values ($1, 'dispute', 'invoice', $2, 'dispute', gen_random_uuid(), 'litige')", [caseId, invoiceId])
      const batch = await prepare()
      expect(batch.status).toBe('ready')
      const reasons = Object.fromEntries(batch.excluded.map((e: any) => [e.reason, e.count]))
      // D1 mail only (address): an order by mail; D2 mail only but no address: elsewhere reachable; D3 suspended; D4 nobody; D5 frozen
      expect((await orders(batch.id)).items.map((o) => [o.debtorId, o.channel])).toEqual([['D1', 'mail']])
      expect(reasons).toEqual({ channel_not_authorized: 1, channel_suspended: 1, no_contact: 1, frozen: 1 })
    })

    it('[rule-recouvrement-documents-required-blocks-reminder] a document required by the policy and missing excludes the invoice from the reminder; the case is excluded when none is left, and ordered once the document is indexed', async () => {
      const doc = policyFile()
      for (const rule of (doc.parameters as any).rules) rule.requiredDocuments = ['contract']
      await world({ lines: [line('FA-001', 'D1', 10), line('FA-002', 'D2', 10)], policy: doc })
      const [{ id }] = await sql("select id from base.invoices where number = 'FA-002'")
      await sql("insert into base.invoice_documents (invoice_id, type, reference) values ($1, 'contract', 'CT-2')", [id])
      const batch = await prepare()
      expect((await orders(batch.id)).items.map((o) => o.debtorId)).toEqual(['D2'])
      expect(batch.excluded).toEqual([{ reason: 'documents_missing', count: 1 }])
      const [{ id: first }] = await sql("select id from base.invoices where number = 'FA-001'")
      await sql("insert into base.invoice_documents (invoice_id, type, reference) values ($1, 'contract', 'CT-1')", [first])
      await sql("update base.daily_batches set status = 'blocked'")
      const again = await prepare()
      expect((await orders(again.id)).items.map((o) => o.debtorId)).toEqual(['D1', 'D2'])
    })

    it('[rule-recouvrement-batch-statement-fresh] without a fresh bank statement the batch is blocked with no order, the cases excluded statement_stale and the check failed in French', async () => {
      await world({ statement: false, lines: [line('FA-001', 'D1', 10), line('FA-002', 'D2', 10)] })
      const batch = await prepare()
      expect(batch).toMatchObject({ status: 'blocked', orderCount: 0, failedChecks: 1 })
      expect(batch.excluded).toEqual([{ reason: 'statement_stale', count: 2 }])
      const c = check(batch, 'statement_fresh')
      expect(c.status).toBe('failed')
      expect(c.problems).toEqual(["Aucun relevé bancaire n'a été confirmé : les ordres d'envoi ne peuvent pas être prévus."])
    })

    it('[rule-recouvrement-batch-statement-fresh] a statement older than the policy accepts blocks the batch', async () => {
      await world()
      // the import refuses a statement that is already too old: age the one that was accepted
      await sql("update base.statements set statement_date = current_date - 40")
      const batch = await prepare()
      expect(check(batch, 'statement_fresh').status).toBe('failed')
      expect(check(batch, 'statement_fresh').problems[0]).toMatch(/^Le dernier relevé bancaire date du \d{2}\/\d{2}\/\d{4} \(40 jours\)/)
    })

    it('[rule-recouvrement-batch-witnesses-replayed][rule-recouvrement-witness-no-order] the witnesses are replayed at each batch without an order, a decision on a real case, a queue item or a transition', async () => {
      await world()
      const before = {
        transitions: (await sql('select count(*)::int as n from base.case_state_history'))[0].n,
        items: (await sql('select count(*)::int as n from base.queue_items'))[0].n,
      }
      const batch = await prepare()
      expect(check(batch, 'witnesses_replayed')).toEqual({ code: 'witnesses_replayed', status: 'passed', problems: [] })
      expect((await sql("select count(*)::int as n from base.decisions where kind = 'daily_action'"))[0].n).toBe(1)
      expect((await sql('select count(*)::int as n from base.send_orders'))[0].n).toBe(1)
      expect((await sql('select count(*)::int as n from base.queue_items'))[0].n).toBe(before.items)
      expect((await sql('select count(*)::int as n from base.case_state_history'))[0].n).toBe(before.transitions)
    })

    it('[rule-recouvrement-batch-brain-decides] a batch of no case is valid: shares of zero, every check passed', async () => {
      await world({ lines: [line('FA-001', 'D1', 10)] })
      await sql("update base.cases set state = 'settled'")
      const batch = await prepare()
      expect(batch).toMatchObject({ status: 'ready', caseCount: 0, orderCount: 0 })
      expect(batch.shares.every((s: any) => s.shareBp === 0 && s.exceeded === false)).toBe(true)
    })

    it('[rule-recouvrement-batch-prescription-flow][rule-recouvrement-prescription] the preparation records the prescription: one item per invoice, once, with a decision', async () => {
      const doc = policyFile()
      for (const rule of (doc.parameters as any).rules) rule.limitation = { delayDays: 100, startsFrom: 'due_date', alertDays: 30 }
      await world({ lines: [line('FA-001', 'D1', 90), line('FA-002', 'D2', 120)], policy: doc })
      const batch = await prepare()
      const items = await sql("select type, object_key, case_id from base.queue_items where type like 'prescription_%' order by type")
      expect(items.map((i) => i.type)).toEqual(['prescription_expired', 'prescription_near'])
      expect((await sql("select count(*)::int as n from base.decisions where kind = 'prescription'"))[0].n).toBe(2)
      await sql("update base.daily_batches set status = 'blocked'")
      await prepare()
      expect(await sql("select 1 from base.queue_items where type like 'prescription_%'")).toHaveLength(2)
      expect(batch.status).toBe('ready')
    })
  })

  describe('replacement and release', () => {
    it('[rule-recouvrement-batch-one-per-day] a second preparation the same day replaces a blocked batch: replaced, its orders cancelled, replacedBy set; the new one comes first', async () => {
      await world({ statement: false })
      const first = await prepare()
      expect(first.status).toBe('blocked')
      await importOf('payments', statementFile())
      const second = await prepare()
      expect(second.status).toBe('ready')
      const old = (await (await get(`/daily-batches/${first.id}`, sup)).json()).batch
      expect(old).toMatchObject({ status: 'replaced', replacedBy: second.id })
      const list = await (await get('/daily-batches', sup)).json()
      expect(list.items.map((b: any) => b.id)).toEqual([second.id, first.id])
      expect(list.total).toBe(2)
    })

    it('[rule-recouvrement-batch-one-per-day][rule-recouvrement-batch-no-duplicate-order] the replaced batch cancels its orders and the active ones stay one per case, kind and day', async () => {
      await world({ lines: [line('FA-001', 'D1', 10)] })
      const first = await prepare()
      await sql("update base.daily_batches set status = 'blocked' where id = $1", [first.id])
      await sql("update base.send_orders set status = 'blocked' where batch_id = $1", [first.id])
      const second = await prepare()
      expect(check(second, 'no_duplicate_order')).toEqual({ code: 'no_duplicate_order', status: 'passed', problems: [] })
      expect((await orders(first.id)).items.map((o) => o.status)).toEqual(['cancelled'])
      expect((await sql("select count(*)::int as n from base.send_orders where status <> 'cancelled'"))[0].n).toBe(1)
    })

    it('[rule-recouvrement-batch-no-duplicate-order] the database refuses a second active order of a case, kind and day, and accepts it once the first is cancelled', async () => {
      await world()
      const batch = await prepare()
      const insert = () =>
        sql(
          `insert into base.send_orders (batch_id, kind, status, case_id, interlocutor_id, channel, conditions, order_date)
           select batch_id, kind, 'planned', case_id, interlocutor_id, channel, conditions, order_date from base.send_orders where batch_id = $1`,
          [batch.id],
        )
      await expect(insert()).rejects.toThrow()
      await sql("update base.send_orders set status = 'cancelled'")
      await insert()
    })

    it('[rule-recouvrement-batch-one-per-day] when the batch of the day is ready a new preparation answers 409 batches.already_released and changes nothing', async () => {
      await world()
      const first = await prepare()
      const res = await post('/daily-batches', sup)
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('batches.already_released')
      expect((await (await get('/daily-batches', sup)).json()).total).toBe(1)
      expect((await (await get(`/daily-batches/${first.id}`, sup)).json()).batch.status).toBe('ready')
    })

    it('[rule-recouvrement-batch-blocked-release-by-decision] a blocked batch is released by a reasoned decision: ready, the releaser and reason kept, the failed checks still displayed, its orders no longer blocked', async () => {
      await world({ lines: [line('FA-001', 'D1', 10)] })
      const first = await prepare()
      await sql("update base.daily_batches set status = 'blocked' where id = $1", [first.id])
      await sql("update base.send_orders set status = 'blocked', block_reason = 'x'")
      const res = await post(`/daily-batches/${first.id}/release`, sup, { reason: '  Relevé vérifié à la main  ' })
      expect(res.status).toBe(200)
      const batch = (await res.json()).batch
      expect(batch).toMatchObject({ status: 'ready', releaseReason: 'Relevé vérifié à la main', releasedBy: { email: 'sup@example.com' } })
      expect(batch.releasedAt).not.toBeNull()
      expect((await orders(first.id)).items).toMatchObject([{ status: 'planned', blockReason: null }])
    })

    it('[rule-recouvrement-batch-blocked-release-by-decision] the failed checks stay displayed after the release', async () => {
      await world({ statement: false })
      const blocked = await prepare()
      const batch = (await (await post(`/daily-batches/${blocked.id}/release`, sup, { reason: 'ok' })).json()).batch
      expect(check(batch, 'statement_fresh').status).toBe('failed')
      expect(batch.failedChecks).toBe(1)
    })

    it('[rule-recouvrement-batch-blocked-release-by-decision] the reason is required (1 to 1000 characters trimmed), the body strict, the id a uuid; unknown 404; a batch that is not blocked 409 batches.not_releasable', async () => {
      await world({ statement: false })
      const blocked = await prepare()
      for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'r'.repeat(1001) }, { reason: 'ok', extra: 1 }, { reason: 5 }]) {
        const res = await post(`/daily-batches/${blocked.id}/release`, sup, body)
        expect([JSON.stringify(body), res.status, (await res.json()).code]).toEqual([JSON.stringify(body), 400, 'api.validation.incoming_failed'])
      }
      expect((await post('/daily-batches/pas-un-uuid/release', sup, { reason: 'ok' })).status).toBe(400)
      expect((await post(`/daily-batches/${UNKNOWN}/release`, sup, { reason: 'ok' })).status).toBe(404)
      // The bound applies to the trimmed reason: 1000 characters surrounded by blanks are accepted.
      const padded = await post(`/daily-batches/${blocked.id}/release`, sup, { reason: `  ${'r'.repeat(1000)}  ` })
      expect(padded.status).toBe(200)
      expect((await padded.json()).batch.releaseReason).toHaveLength(1000)
      const again = await post(`/daily-batches/${blocked.id}/release`, sup, { reason: 'encore' })
      expect(again.status).toBe(409)
      expect((await again.json()).code).toBe('batches.not_releasable')
    })

    it('[rule-recouvrement-batch-release-when-checks-pass] a ready batch and a replaced batch cannot be released', async () => {
      await world({ statement: false })
      const first = await prepare()
      await importOf('payments', statementFile())
      const second = await prepare()
      for (const id of [second.id, first.id]) {
        const res = await post(`/daily-batches/${id}/release`, sup, { reason: 'x' })
        expect([res.status, (await res.json()).code]).toEqual([409, 'batches.not_releasable'])
      }
    })

    it('[rule-recouvrement-batch-prepared-by-supervisor] preparation and release are traced with the object type "Lot du jour" and their summaries, without the reason', async () => {
      await world({ statement: false })
      await createUser({ email: 'admin@example.com', role: 'admin' })
      const blocked = await prepare()
      await post(`/daily-batches/${blocked.id}/release`, sup, { reason: 'Décision du superviseur' })
      const logRes = await get('/audit-logs?size=100', await login('admin@example.com'))
      const log = await logRes.json()
      expect([logRes.status, JSON.stringify(log).slice(0, 200)]).toEqual([200, expect.any(String)])
      const prepared = log.entries.find((e: any) => e.action === 'batches:prepare')
      const released = log.entries.find((e: any) => e.action === 'batches:release')
      expect(prepared).toMatchObject({ objectType: 'Lot du jour', objectId: blocked.id })
      expect(prepared.summary).toBe(`Lot du jour du ${today().slice(8)}/${today().slice(5, 7)}/${today().slice(0, 4)} préparé : 0 ordre, bloqué.`)
      expect(released.summary).toMatch(/^Lot du jour du \d{2}\/\d{2}\/\d{4} libéré par décision du superviseur\.$/)
      expect(JSON.stringify(log.entries)).not.toContain('Décision du superviseur')
    })
  })

  describe('proposed transfer', () => {
    const delayed = [line('FA-001', 'D1', 120), line('FA-002', 'DC', 120, { nature: 'entreprise' })]

    it('[rule-recouvrement-company-transfer-proposed][rule-recouvrement-batch-families-no-transfer][rule-recouvrement-family-transfer-never-executed] the transfer of a company is proposed like the one of a family: supervisor queue, one open transfer_proposed item, never transferred by the brain', async () => {
      const doc = policyFile()
      const table = (doc.decision as any).nodes[1].content.rules
      table.splice(1, 0, { _id: 'rt', i_state: '', i_late: '>= 90', o_action: '"transfer_proposed"', o_rule: '"r-transfer"' })
      await world({ lines: delayed, policy: doc })
      await prepare()
      expect((await sql('select debtor_id, state from base.cases order by debtor_id')).map((c) => c.state)).toEqual(['supervisor_queue', 'supervisor_queue'])
      expect((await sql("select count(*)::int as n from base.queue_items where type = 'transfer_proposed' and status = 'open'"))[0].n).toBe(2)
      expect((await sql("select count(*)::int as n from base.cases where state = 'transferred'"))[0].n).toBe(0)
      // a second preparation opens no second item for the same case
      await sql("update base.daily_batches set status = 'blocked'")
      await prepare()
      expect((await sql("select count(*)::int as n from base.queue_items where type = 'transfer_proposed'"))[0].n).toBe(2)
    })
  })

  describe('automatic stop', () => {
    const caps = (reminder: number) => ({ none: 10000, reminder, proposal: 10000, transfer_proposed: 10000 })

    it('[rule-recouvrement-batch-auto-stop] before ten previous batches the fixed cap applies: strictly above blocks, equal does not; a block opens one alert', async () => {
      const doc = policyFile()
      ;(doc.parameters as any).global.decisionTypeCapsBp = caps(5000)
      await world({ lines: [line('FA-001', 'D1', 10), line('FA-002', 'D2', 10), line('FA-003', 'D3', 0), line('FA-004', 'D4', 0)], policy: doc })
      const equal = await prepare()
      expect(equal.status).toBe('ready')
      expect(equal.shares.find((s: any) => s.type === 'reminder')).toMatchObject({ count: 2, shareBp: 5000, mode: 'fixed_cap', capBp: 5000, meanBp: null, sigmaBp: null, thresholdBp: null, exceeded: false })
      await sql('update base.invoices set due_date = $1 where number = $2', [D(-10), 'FA-003'])
      await sql("update base.daily_batches set status = 'blocked'")
      const over = await prepare()
      expect(over.status).toBe('blocked')
      expect(over.shares.find((s: any) => s.type === 'reminder')).toMatchObject({ count: 3, shareBp: 7500, exceeded: true })
      expect(check(over, 'decision_share').status).toBe('failed')
      expect(check(over, 'decision_share').problems[0]).toBe('La part des relances (75 %) dépasse le plafond de 50 % fixé par la politique.')
      expect((await sql("select count(*)::int as n from base.queue_items where type = 'alert' and status = 'open'"))[0].n).toBe(1)
      // the orders of a blocked batch are blocked too
      expect((await orders(over.id)).items.every((o) => o.status === 'blocked')).toBe(true)
    })

    async function seedHistory(reminderShares: number[]) {
      for (const [k, reminder] of reminderShares.entries()) {
        const shares = ['none', 'reminder', 'proposal', 'transfer_proposed'].map((type) => ({
          type,
          count: 0,
          shareBp: type === 'reminder' ? reminder : type === 'none' ? 10000 - reminder : 0,
          mode: 'fixed_cap',
          capBp: 10000,
          meanBp: null,
          sigmaBp: null,
          thresholdBp: null,
          exceeded: false,
        }))
        await sql(
          `insert into base.daily_batches (batch_date, status, prepared_by, case_count, checks, shares, excluded)
           values ($1, 'ready', (select id from base.users limit 1), 100, '[]', $2::jsonb, '[]')`,
          [D(-(k + 1)), JSON.stringify(shares)],
        )
      }
    }

    // 100 cases: `reminders` of them are late by a day, the others are not
    const hundred = (reminders: number) =>
      Array.from({ length: 100 }, (_, i) => line(`FA-${String(i).padStart(3, '0')}`, `D${String(i).padStart(3, '0')}`, i < reminders ? 5 : 0))

    it('[rule-recouvrement-batch-auto-stop][rule-recouvrement-decision-share-sigma][D-0005] with ten batches at 40 % and 60 % alternately, a batch at 81 % is blocked (deviation 10 points, threshold 30, gap 31); at 79 % it passes', async () => {
      await world({ lines: hundred(81) })
      await seedHistory([4000, 6000, 4000, 6000, 4000, 6000, 4000, 6000, 4000, 6000])
      const blocked = await prepare()
      expect(blocked.status).toBe('blocked')
      const reminder = blocked.shares.find((s: any) => s.type === 'reminder')
      expect(reminder).toMatchObject({ count: 81, shareBp: 8100, mode: 'statistical', capBp: null, meanBp: 5000, sigmaBp: 1000, thresholdBp: 3000, exceeded: true })
      expect(check(blocked, 'decision_share').problems.find((p: string) => p.includes('relances'))).toMatch(/^La part des relances \(81 %\) s'écarte de la moyenne des 10 derniers lots \(50 %\) de plus de trois écarts-types \(30 %\)\.$/)

      await sql('update base.invoices set due_date = current_date')
      await sql("update base.invoices set due_date = current_date - 5 where substring(number from 4)::int < 79")
      const passing = await prepare()
      expect(passing.shares.find((s: any) => s.type === 'reminder')).toMatchObject({ shareBp: 7900, mode: 'statistical', exceeded: false })
      expect(passing.status).toBe('ready')
    })

    it('[rule-recouvrement-decision-share-sigma] with a null deviation any share different from the mean blocks; the same share does not', async () => {
      await world({ lines: hundred(50) })
      await seedHistory(Array(10).fill(5000))
      const same = await prepare()
      expect(same.shares.find((s: any) => s.type === 'reminder')).toMatchObject({ sigmaBp: 0, exceeded: false })
      await sql("update base.daily_batches set status = 'blocked' where id = $1", [same.id])
      await sql("update base.invoices set due_date = current_date - 5 where number = 'FA-099'")
      const other = await prepare()
      expect(other.shares.find((s: any) => s.type === 'reminder')).toMatchObject({ shareBp: 5100, exceeded: true })
      expect(other.status).toBe('blocked')
    })

    it('[rule-recouvrement-batch-auto-stop] only the 20 last batches that are not replaced count', async () => {
      await world({ lines: hundred(50) })
      await seedHistory([...Array(10).fill(9000), ...Array(10).fill(5000)])
      const batch = await prepare()
      expect(batch.shares.find((s: any) => s.type === 'reminder')).toMatchObject({ meanBp: 7000 })
    })
  })

  describe('reading', () => {
    it('[rule-recouvrement-batch-prepared-by-supervisor] the list is paginated (size 1 to 100), newest date first; orders are sorted by customer, filterable and paginated; unknown 404, malformed 400', async () => {
      await world({ lines: ['D3', 'D1', 'D2', 'D4'].map((d, i) => line(`FA-00${i}`, d, i < 2 ? 10 : 50)) })
      const batch = await prepare()
      await sql('update base.send_orders set order_date = order_date - 1 where batch_id = $1', [batch.id])
      await sql('update base.daily_batches set batch_date = batch_date - 1 where id = $1', [batch.id])
      const today1 = await prepare()
      expect((await (await get('/daily-batches?size=1', sup)).json()).items.map((b: any) => b.id)).toEqual([today1.id])
      expect((await (await get('/daily-batches?from=1&size=1', sup)).json()).items.map((b: any) => b.id)).toEqual([batch.id])
      expect(Object.keys((await (await get('/daily-batches', sup)).json()).items[0]).sort()).toEqual(['caseCount', 'createdAt', 'date', 'failedChecks', 'id', 'orderCount', 'preparedBy', 'releasedAt', 'releasedBy', 'status'])
      for (const q of ['size=0', 'size=101', 'from=-1']) expect((await get(`/daily-batches?${q}`, sup)).status).toBe(400)

      expect((await orders(today1.id)).items.map((o) => o.debtorId)).toEqual(['D1', 'D2', 'D3', 'D4'])
      expect((await orders(today1.id, 'type=reminder')).total).toBe(2)
      expect((await orders(today1.id, 'type=proposal')).items.map((o) => o.type)).toEqual(['proposal', 'proposal'])
      expect((await orders(today1.id, 'channel=mail')).total).toBe(0)
      expect((await orders(today1.id, 'channel=voice')).total).toBe(4)
      expect((await orders(today1.id, 'from=1&size=2')).items.map((o) => o.debtorId)).toEqual(['D2', 'D3'])
      for (const q of ['type=autre', 'channel=sms', 'size=0', 'size=101', 'from=-1']) expect([q, (await get(`/daily-batches/${today1.id}/orders?${q}`, sup)).status]).toEqual([q, 400])
      expect((await get(`/daily-batches/${UNKNOWN}/orders`, sup)).status).toBe(404)
      expect((await get('/daily-batches/pas-un-uuid/orders', sup)).status).toBe(400)
      expect((await get(`/daily-batches/${UNKNOWN}`, sup)).status).toBe(404)
      expect((await get('/daily-batches/x', sup)).status).toBe(400)
    })
  })
})
