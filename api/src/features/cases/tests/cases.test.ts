import { closePool, resetData, sql } from '../../../platform/testing/helpers'
import { accountWithProfile, get, importReceivables, receivablesCsv, UNKNOWN } from '../../recovery-common/tests/support'

describe('cases routes', () => {
  let sup: string
  let lit: string

  beforeEach(async () => {
    await resetData()
    sup = (await accountWithProfile('sup@example.com', 'supervisor')).token
    lit = (await accountWithProfile('lit@example.com', 'litigation')).token
    await importReceivables(
      sup,
      receivablesCsv([
        { numero: 'FA-001', debtor: 'CLI-A', montant: '100,00' },
        { numero: 'FA-002', debtor: 'CLI-A', montant: '50,00' },
        { numero: 'FB-001', debtor: 'CLI-B', nature: 'entreprise', montant: '900,00', segment: 'premium' },
      ]),
      '1 050,00',
    )
  })
  afterAll(closePool)

  it('[rule-recouvrement-cases-supervisor-only] anonymous 401 and the other profiles 403 on every route', async () => {
    for (const path of ['/cases', '/cases/filters', `/cases/${UNKNOWN}`, `/cases/${UNKNOWN}/decisions`, `/cases/${UNKNOWN}/state-history`, '/invoices?number=F']) {
      expect((await get(path)).status).toBe(401)
      expect((await get(path, lit)).status).toBe(403)
    }
  })

  describe('GET /cases', () => {
    it('[rule-recouvrement-cases-supervisor-only] lists the cases by negotiable amount, then customer identifier', async () => {
      const body = await (await get('/cases', sup)).json()
      expect(body.total).toBe(2)
      expect(body.items.map((c: any) => c.debtorId)).toEqual(['CLI-A', 'CLI-B'].sort((a, b) => (a === 'CLI-B' ? -1 : 1) || a.localeCompare(b)))
      expect(body.items[0]).toMatchObject({ debtorId: 'CLI-B', nature: 'company', segment: 'premium', state: 'open', openInvoices: 1 })
    })

    it('[rule-recouvrement-cases-supervisor-only] filters by search, nature, segment, creditor and state; paginates', async () => {
      expect((await (await get('/cases?search=cli-a', sup)).json()).total).toBe(1)
      expect((await (await get('/cases?nature=company', sup)).json()).items.map((c: any) => c.debtorId)).toEqual(['CLI-B'])
      expect((await (await get('/cases?segment=standard', sup)).json()).total).toBe(1)
      expect((await (await get('/cases?creditor=123456789', sup)).json()).total).toBe(2)
      expect((await (await get('/cases?state=frozen', sup)).json()).total).toBe(0)
      const page = await (await get('/cases?from=1&size=1', sup)).json()
      expect(page.total).toBe(2)
      expect(page.items).toHaveLength(1)
    })

    it.each(['size=0', 'size=101', 'from=-1', 'state=inconnu', 'nature=x', 'creditor=12'])('query %s is 400', async (query) => {
      expect((await get(`/cases?${query}`, sup)).status).toBe(400)
    })
  })

  describe('GET /cases/filters', () => {
    it('[rule-recouvrement-cases-supervisor-only] gives the segments and creditors present', async () => {
      expect(await (await get('/cases/filters', sup)).json()).toEqual({ segments: ['premium', 'standard'], creditors: ['123456789'] })
    })
  })

  describe('GET /cases/:id', () => {
    it('[rule-recouvrement-negotiable-amount] reads the case with its invoices, freezes and negotiable amount', async () => {
      const [row] = await sql("select id from base.cases where debtor_id = 'CLI-A'")
      const { case: detail } = await (await get(`/cases/${row.id}`, sup)).json()
      expect(detail).toMatchObject({ debtorId: 'CLI-A', negotiableCents: 15000, openBalanceCents: 15000, state: 'open' })
      expect(detail.invoices.map((i: any) => i.number).sort()).toEqual(['FA-001', 'FA-002'])
      expect(detail.freezes).toEqual([])
    })

    it('[rule-recouvrement-invoice-dispute-frozen] a frozen invoice leaves the negotiable amount', async () => {
      const [row] = await sql("select c.id as case_id, i.id as invoice_id from base.cases c join base.invoices i on i.case_id = c.id where i.number = 'FA-001'")
      const [dispute] = await sql(
        "insert into base.disputes (invoice_id, case_id, origin, reason, owner) values ($1, $2, 'service', 'motif', 'resp') returning id",
        [row.invoice_id, row.case_id],
      )
      await sql(
        "insert into base.freezes (case_id, code, scope, invoice_id, source_type, source_id, reference) values ($1, 'dispute', 'invoice', $2, 'dispute', $3, 'motif')",
        [row.case_id, row.invoice_id, dispute.id],
      )
      const { case: detail } = await (await get(`/cases/${row.case_id}`, sup)).json()
      expect(detail.negotiableCents).toBe(5000)
      expect(detail.freezes).toHaveLength(1)
    })

    it('unknown case 404, malformed identifier 400', async () => {
      expect((await get(`/cases/${UNKNOWN}`, sup)).status).toBe(404)
      expect((await get('/cases/nope', sup)).status).toBe(400)
    })
  })

  describe('GET /cases/:id/decisions and /cases/:id/state-history', () => {
    it('[rule-recouvrement-state-transitions-logged] the creation of the case opens its history; no decision yet', async () => {
      const [row] = await sql("select id from base.cases where debtor_id = 'CLI-A'")
      const history = await (await get(`/cases/${row.id}/state-history`, sup)).json()
      expect(history.total).toBe(1)
      expect(history.items[0]).toMatchObject({ from: null, to: 'open', cause: 'import' })
      expect(await (await get(`/cases/${row.id}/decisions`, sup)).json()).toEqual({ items: [], total: 0 })
    })

    it('unknown case 404 on both routes, bad page 400', async () => {
      expect((await get(`/cases/${UNKNOWN}/decisions`, sup)).status).toBe(404)
      expect((await get(`/cases/${UNKNOWN}/state-history`, sup)).status).toBe(404)
      const [row] = await sql("select id from base.cases where debtor_id = 'CLI-A'")
      expect((await get(`/cases/${row.id}/decisions?size=0`, sup)).status).toBe(400)
    })
  })

  describe('GET /invoices', () => {
    it('searches the open invoices by the beginning of their number, case-insensitive', async () => {
      const body = await (await get('/invoices?number=fa-', sup)).json()
      expect(body.total).toBe(2)
      expect(body.items.map((i: any) => i.number)).toEqual(['FA-001', 'FA-002'])
      expect(body.items[0]).toMatchObject({ debtorId: 'CLI-A', balanceCents: 10000, frozen: false })
    })

    it('the number is required (400)', async () => {
      expect((await get('/invoices', sup)).status).toBe(400)
      expect((await get('/invoices?number=', sup)).status).toBe(400)
    })
  })
})
