import { closePool, resetData, sql } from '../../../platform/testing/helpers'
import { addDays } from '../../cases/clock.service'
import { csv } from '../../imports/tests/files'
import { accountWithProfile, get, importReceivables, post, receivablesCsv, today, UNKNOWN, upload } from '../../recovery-common/tests/support'

// Decisions of the supervisor on the items of the decision queue.

const D = (n: number) => addDays(today(), n)

describe('decision queue: decisions', () => {
  let sup: string
  let supId: string

  const decide = (id: string, decision: string, reason = 'Décision de test', extra: object = {}) =>
    post(`/decision-queue/items/${id}/decision`, sup, { decision, reason, ...extra })

  async function world() {
    await importReceivables(
      sup,
      receivablesCsv(
        [
          { numero: 'FA-001', debtor: 'D1', montant: '100,00', echeance: D(-30) },
          { numero: 'FA-002', debtor: 'D2', montant: '100,00', echeance: D(-30) },
          { numero: 'FA-003', debtor: 'D3', montant: '40,00', echeance: D(-30) },
        ],
        D(-3),
      ),
      '240,00',
    )
  }

  async function seed(type: string, debtor: string | null, key: string, details: object[] = []): Promise<string> {
    const [row] = await sql(
      `insert into base.queue_items (type, case_id, object_key, summary, details)
       values ($1, (select id from base.cases where debtor_id = $2), $3, 'Élément de test', $4::jsonb) returning id`,
      [type, debtor, key, JSON.stringify(details)],
    )
    return row.id
  }

  const caseOf = async (debtor: string) => (await sql('select * from base.cases where debtor_id = $1', [debtor]))[0]
  const itemOf = async (id: string) => (await sql('select * from base.queue_items where id = $1', [id]))[0]

  async function unassignedPayment(amount = '100,00') {
    const file = csv([['reference', 'montant', 'date_paiement', 'date_releve'], ['VIR INCONNU', amount, today(), today()]])
    const pre = await (await upload('/recovery-imports/payments/preview', file, sup)).json()
    expect((await post(`/recovery-imports/payments/${pre.importId}/confirm`, sup)).status).toBe(200)
    const items = (await (await get('/decision-queue/items?type=unassigned_payment', sup)).json()).items
    expect(items).toHaveLength(1)
    return items[0]
  }

  beforeEach(async () => {
    await resetData()
    const account = await accountWithProfile('sup@example.com', 'supervisor')
    sup = account.token
    supId = account.id
  })
  afterAll(closePool)

  it('[rule-recouvrement-queue-contents] anonymous 401, other profiles and plain users 403 before any validation', async () => {
    await world()
    const id = await seed('alert', 'D1', 'a1')
    const others = [
      (await accountWithProfile('agent@example.com', 'agent')).token,
      (await accountWithProfile('lit@example.com', 'litigation')).token,
      (await accountWithProfile('plain@example.com', null)).token,
    ]
    const { call } = await import('../../../platform/testing/helpers')
    expect((await call(`/decision-queue/items/${id}/decision`, { method: 'POST', body: { decision: 'acknowledge', reason: 'x' } })).status).toBe(401)
    for (const token of others) {
      for (const body of [{ decision: 'acknowledge', reason: 'x' }, { decision: 5 }]) {
        const res = await call(`/decision-queue/items/${id}/decision`, { method: 'POST', body, headers: { authorization: `Bearer ${token}` } })
        expect([res.status, (await res.json()).code]).toEqual([403, 'security.access_denied'])
      }
    }
    expect((await itemOf(id)).status).toBe('open')
  })

  it('[rule-recouvrement-queue-decision-motivated] the reason is required and trimmed, the body strict, the id a uuid; an unknown item is 404', async () => {
    await world()
    const id = await seed('alert', 'D1', 'a1')
    const bad = [
      {}, { decision: 'acknowledge' }, { reason: 'x' }, { decision: 'acknowledge', reason: '   ' }, { decision: 'acknowledge', reason: 'r'.repeat(1001) },
      { decision: '', reason: 'x' }, { decision: 'd'.repeat(51), reason: 'x' }, { decision: 'acknowledge', reason: 'x', extra: 1 },
      { decision: 'acknowledge', reason: 'x', invoiceId: UNKNOWN }, { decision: 'assign', reason: 'x' }, { decision: 'assign', reason: 'x', invoiceId: 'nope' },
    ]
    for (const body of bad) expect([JSON.stringify(body), (await post(`/decision-queue/items/${id}/decision`, sup, body)).status]).toEqual([JSON.stringify(body), 400])
    expect((await post('/decision-queue/items/nope/decision', sup, { decision: 'acknowledge', reason: 'x' })).status).toBe(400)
    const missing = await decide(UNKNOWN, 'acknowledge')
    expect([missing.status, (await missing.json()).code]).toEqual([404, 'repository.not_found'])
    expect((await itemOf(id)).status).toBe('open')
    expect((await decide(id, 'acknowledge', ` ${'r'.repeat(1000)} `)).status).toBe(200)
  })

  it('[rule-recouvrement-queue-allowed-decisions] each type allows the decisions of the referential only: 409 queue.decision_not_allowed', async () => {
    await world()
    const wrong: Record<string, string> = {
      contestation: 'keep', amount_over_threshold: 'keep', ladder_exhausted: 'authorize', unassigned_payment: 'acknowledge', accounting_gap: 'keep',
      prescription_near: 'keep', prescription_expired: 'keep', alert: 'transfer', human_request: 'acknowledge', transfer_proposed: 'transfer',
    }
    let k = 0
    for (const [type, code] of Object.entries(wrong)) {
      const id = await seed(type, 'D1', `k${k++}`)
      const res = await decide(id, code)
      expect([type, res.status, (await res.json()).code]).toEqual([type, 409, 'queue.decision_not_allowed'])
      expect((await itemOf(id)).status).toBe('open')
    }
  })

  it('[rule-recouvrement-queue-decision-motivated] the decision keeps its code, trimmed reason, author and instant; the audit journal names it without the reason', async () => {
    await world()
    const id = await seed('alert', 'D1', 'a1')
    const res = await decide(id, 'acknowledge', '  Alerte vue par le superviseur  ')
    expect(res.status).toBe(200)
    const { item } = await res.json()
    expect(item).toMatchObject({
      id, status: 'decided', allowedDecisions: [],
      decision: { code: 'acknowledge', reason: 'Alerte vue par le superviseur', decidedBy: { id: supId, email: 'sup@example.com' } },
    })
    const log = await (await get('/audit-logs?action=queue:decide', sup)).json()
    expect(log.total).toBe(1)
    expect(log.entries[0]).toMatchObject({ objectType: 'Élément de file', objectId: id, summary: 'Décision « Acquitter » sur un élément « Alerte ».' })
    expect(JSON.stringify(log.entries)).not.toContain('Alerte vue')
  })

  it('[rule-recouvrement-queue-decided-final] a decided item does not change; two simultaneous decisions give one success and one 409', async () => {
    await world()
    const a = await seed('prescription_near', 'D1', 'a')
    const b = await seed('prescription_near', 'D2', 'b')
    expect((await decide(a, 'acknowledge')).status).toBe(200)
    for (const code of ['acknowledge', 'transfer', 'unknown']) {
      const res = await decide(a, code)
      expect([res.status, (await res.json()).code]).toEqual([409, 'queue.already_decided'])
    }
    const race = await Promise.all([decide(b, 'acknowledge'), decide(b, 'acknowledge')])
    expect(race.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await race.find((r) => r.status === 409)!.json()).code).toBe('queue.already_decided')
  })

  it('[rule-recouvrement-queue-effects] acknowledge, keep and resume only close the item', async () => {
    await world()
    for (const [type, code] of [['contestation', 'acknowledge'], ['ladder_exhausted', 'keep'], ['human_request', 'resume']]) {
      const id = await seed(type, 'D1', type)
      const before = await caseOf('D1')
      expect((await decide(id, code)).status).toBe(200)
      expect((await itemOf(id)).decision_code).toBe(code)
      expect((await caseOf('D1')).state).toBe(before.state)
    }
  })

  it('[rule-recouvrement-queue-effects] authorize memorizes the negotiable amount and gives the case back to the brain', async () => {
    await world()
    const id = await seed('amount_over_threshold', 'D1', 'D1')
    await sql("update base.cases set state = 'supervisor_queue' where debtor_id = 'D1'")
    expect((await decide(id, 'authorize')).status).toBe(200)
    const c = await caseOf('D1')
    expect(Number(c.authorized_cents)).toBe(10000)
    expect(c.state).toBe('open')
    const history = await sql("select * from base.case_state_history where case_id = $1 order by id desc limit 1", [c.id])
    expect(history[0]).toMatchObject({ from_state: 'supervisor_queue', to_state: 'open', cause: 'queue_item_decided', actor: 'sup@example.com' })
  })

  it('[rule-recouvrement-queue-effects] transfer and approve_transfer bring the case to transferred (cause transfer_approved); a frozen case is refused', async () => {
    await world()
    const one = await seed('amount_over_threshold', 'D1', 'D1')
    const two = await seed('transfer_proposed', 'D2', 'D2')
    expect((await decide(one, 'transfer')).status).toBe(200)
    expect((await decide(two, 'approve_transfer')).status).toBe(200)
    for (const d of ['D1', 'D2']) {
      const c = await caseOf(d)
      expect(c.state).toBe('transferred')
      expect(c.transferred_at).not.toBeNull()
      const history = await sql('select * from base.case_state_history where case_id = $1 order by id desc limit 1', [c.id])
      expect(history[0]).toMatchObject({ to_state: 'transferred', cause: 'transfer_approved' })
    }
    await sql("update base.cases set state = 'frozen' where debtor_id = 'D3'")
    const frozen = await seed('prescription_near', 'D3', 'D3')
    const res = await decide(frozen, 'transfer')
    expect([res.status, (await res.json()).code]).toEqual([409, 'queue.decision_not_allowed'])
    expect((await itemOf(frozen)).status).toBe('open')
  })

  it('[rule-recouvrement-queue-effects] reject_transfer keeps the rule the brain proposed with and closes the item', async () => {
    await world()
    const id = await seed('transfer_proposed', 'D1', 'D1', [{ label: 'Règle appliquée', value: 'r-transfer' }])
    expect((await decide(id, 'reject_transfer')).status).toBe(200)
    expect((await caseOf('D1')).rejected_transfer_rule).toBe('r-transfer')
  })

  describe('unassigned payments', () => {
    it('[rule-recouvrement-queue-effects] assign needs an invoice, applies the payment, lifts the freezes and gives the cases back to the brain', async () => {
      await world()
      const item = await unassignedPayment()
      expect(item.candidates.map((c: any) => c.number).sort()).toEqual(['FA-001', 'FA-002'])
      expect((await caseOf('D1')).state).toBe('frozen')
      expect((await decide(item.id, 'assign')).status).toBe(400)
      const target = item.candidates.find((c: any) => c.number === 'FA-001')
      const res = await decide(item.id, 'assign', 'Paiement du client D1', { invoiceId: target.invoiceId })
      expect(res.status).toBe(200)
      expect((await res.json()).item.status).toBe('decided')
      expect((await caseOf('D1')).state).toBe('settled')
      expect((await caseOf('D2')).state).toBe('open')
      expect(await sql('select * from base.freezes where released_at is null')).toEqual([])
      const [alloc] = await sql("select * from base.payment_allocations where origin = 'supervisor'")
      expect(alloc).toMatchObject({ invoice_id: target.invoiceId, assigned_by: supId })
      expect(Number(alloc.amount_cents)).toBe(10000)
    })

    it('[rule-recouvrement-queue-effects] the applied amount is the smaller of the payment and the balance; the excess opens a new item', async () => {
      await world()
      const item = await unassignedPayment()
      const [small] = await sql("select id from base.invoices where number = 'FA-003'")
      expect((await decide(item.id, 'assign', 'Affectation partielle', { invoiceId: small.id })).status).toBe(200)
      expect((await caseOf('D3')).state).toBe('settled')
      const open = (await (await get('/decision-queue/items?type=unassigned_payment', sup)).json()).items
      expect(open).toHaveLength(1)
      expect(open[0].id).not.toBe(item.id)
      expect(open[0].summary).toContain('60,00')
    })

    it('[rule-recouvrement-queue-effects] an unknown, settled or not open invoice is refused: 409 queue.invoice_not_open', async () => {
      await world()
      const item = await unassignedPayment()
      const [settled] = await sql("update base.invoices set balance_cents = 0 where number = 'FA-003' returning id")
      for (const invoiceId of [UNKNOWN, settled.id]) {
        const res = await decide(item.id, 'assign', 'x', { invoiceId })
        expect([res.status, (await res.json()).code]).toEqual([409, 'queue.invoice_not_open'])
      }
      expect((await itemOf(item.id)).status).toBe('open')
    })
  })
})
