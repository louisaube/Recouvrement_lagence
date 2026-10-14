import { closePool, resetData, sql } from '../../../platform/testing/helpers'
import { accountWithProfile, get, importReceivables, receivablesCsv, UNKNOWN } from '../../recovery-common/tests/support'

describe('disputes routes', () => {
  let sup: string
  let lit: string
  let litId: string
  const ids: Record<string, { invoice: string; case: string }> = {}

  const open = async (number: string, origin: string, reason: string, openedBy: string | null = null) => {
    const { invoice, case: caseId } = ids[number]
    const [dispute] = await sql(
      "insert into base.disputes (invoice_id, case_id, origin, reason, owner, opened_by) values ($1, $2, $3, $4, 'Service litiges', $5) returning id",
      [invoice, caseId, origin, reason, openedBy],
    )
    await sql(
      "insert into base.freezes (case_id, code, scope, invoice_id, source_type, source_id, reference) values ($1, 'dispute', 'invoice', $2, 'dispute', $3, $4)",
      [caseId, invoice, dispute.id, reason],
    )
    return dispute.id as string
  }

  beforeEach(async () => {
    await resetData()
    sup = (await accountWithProfile('sup@example.com', 'supervisor')).token
    const account = await accountWithProfile('lit@example.com', 'litigation')
    lit = account.token
    litId = account.id
    await importReceivables(
      sup,
      receivablesCsv([
        { numero: 'FA-001', debtor: 'CLI-A', montant: '100,00' },
        { numero: 'FA-002', debtor: 'CLI-A', montant: '50,00' },
        { numero: 'FB-001', debtor: 'CLI-B', montant: '900,00' },
      ]),
      '1 050,00',
    )
    for (const r of await sql('select i.number, i.id as invoice, i.case_id as "case" from base.invoices i')) ids[r.number] = { invoice: r.invoice, case: r.case }
  })
  afterAll(closePool)

  it('[rule-recouvrement-disputes-litigation-only] anonymous 401, the supervisor 403, on every route', async () => {
    for (const path of ['/disputes', '/disputes/invoices?number=F', `/disputes/${UNKNOWN}`]) {
      expect((await get(path)).status).toBe(401)
      expect((await get(path, sup)).status).toBe(403)
    }
  })

  describe('GET /disputes', () => {
    it('[rule-recouvrement-disputes-litigation-only] lists the open disputes, oldest first, with the invoice and the state of the case', async () => {
      await open('FA-001', 'import', 'Facture contestée')
      await sql("update base.disputes set opened_at = opened_at - interval '1 day'")
      await open('FB-001', 'service', 'Erreur de livraison', litId)
      const body = await (await get('/disputes', lit)).json()
      expect(body.total).toBe(2)
      expect(body.items.map((d: any) => d.invoiceNumber)).toEqual(['FA-001', 'FB-001'])
      expect(body.items[0]).toMatchObject({
        status: 'open', origin: 'import', creditorSiren: '123456789', balanceCents: 10000, debtorId: 'CLI-A', caseState: 'open',
        reason: 'Facture contestée', owner: 'Service litiges', closedAt: null,
      })
    })

    it('[rule-recouvrement-disputes-litigation-only] filters by status, origin and search; paginates', async () => {
      const closed = await open('FA-002', 'service', 'Doublon', litId)
      await sql("update base.disputes set closed_at = now(), closed_by = $1, close_note = 'réglé' where id = $2", [litId, closed])
      await sql('delete from base.freezes where source_id = $1', [closed])
      await open('FA-001', 'import', 'Facture contestée')
      expect((await (await get('/disputes', lit)).json()).total).toBe(1)
      expect((await (await get('/disputes?status=closed', lit)).json()).items.map((d: any) => d.invoiceNumber)).toEqual(['FA-002'])
      expect((await (await get('/disputes?status=all', lit)).json()).total).toBe(2)
      expect((await (await get('/disputes?status=all&origin=service', lit)).json()).total).toBe(1)
      expect((await (await get('/disputes?search=cli-a', lit)).json()).total).toBe(1)
      expect((await (await get('/disputes?search=fb-', lit)).json()).total).toBe(0)
      const page = await (await get('/disputes?status=all&from=1&size=1', lit)).json()
      expect(page.total).toBe(2)
      expect(page.items).toHaveLength(1)
    })

    it.each(['status=x', 'origin=x', 'size=0', 'size=101', 'search='])('query %s is 400', async (query) => {
      expect((await get(`/disputes?${query}`, lit)).status).toBe(400)
    })
  })

  describe('GET /disputes/invoices', () => {
    it('[rule-recouvrement-disputes-litigation-only] searches the open invoices by number prefix, sorted by number, with their freeze', async () => {
      await open('FA-001', 'service', 'Motif', litId)
      const body = await (await get('/disputes/invoices?number=fa', lit)).json()
      expect(body.items.map((i: any) => [i.number, i.frozen])).toEqual([['FA-001', true], ['FA-002', false]])
      expect(body.total).toBe(2)
    })

    it('treats % and _ literally and requires the number', async () => {
      expect((await (await get('/disputes/invoices?number=%25', lit)).json()).total).toBe(0)
      expect((await get('/disputes/invoices', lit)).status).toBe(400)
    })
  })

  describe('GET /disputes/:id', () => {
    it('[rule-recouvrement-dispute-contestation-origin] reads the dispute with its invoice, the summary of its case and its author', async () => {
      const id = await open('FA-001', 'service', 'Motif', litId)
      const { dispute } = await (await get(`/disputes/${id}`, lit)).json()
      expect(dispute).toMatchObject({
        id, status: 'open', origin: 'service', invoiceNumber: 'FA-001', closeNote: null, closedBy: null, contestation: null,
        openedBy: { id: litId, email: 'lit@example.com' },
        invoice: { number: 'FA-001', frozen: true },
        case: { debtorId: 'CLI-A', nature: 'family', state: 'open', openInvoices: 2, frozenInvoices: 1 },
      })
    })

    it('an import dispute has no author', async () => {
      const id = await open('FB-001', 'import', 'Motif')
      expect((await (await get(`/disputes/${id}`, lit)).json()).dispute.openedBy).toBeNull()
    })

    it('unknown dispute 404 repository.not_found, malformed identifier 400', async () => {
      const res = await get(`/disputes/${UNKNOWN}`, lit)
      expect(res.status).toBe(404)
      expect((await res.json()).code).toBe('repository.not_found')
      expect((await get('/disputes/nope', lit)).status).toBe(400)
    })
  })
})
