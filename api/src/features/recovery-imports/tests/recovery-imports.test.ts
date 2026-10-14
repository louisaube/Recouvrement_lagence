import { csv } from '../../imports/tests/files'
import { closePool, resetData, sql } from '../../../platform/testing/helpers'
import { accountWithProfile, get, post, receivablesCsv, today, UNKNOWN, upload } from '../../recovery-common/tests/support'

const EXTRACTION = '2026-10-01'
const TYPES = ['receivables', 'payments', 'disputes', 'contacts', 'documents']

describe('recovery imports routes', () => {
  let sup: string
  let sup2: string
  let lit: string

  const previewOf = async (type: string, content: Buffer, controlTotal?: string, token: string = sup) => {
    const query = controlTotal === undefined ? '' : `?controlTotal=${encodeURIComponent(controlTotal)}`
    const res = await upload(`/recovery-imports/${type}/preview${query}`, content, token)
    return { res, body: await res.json() }
  }
  const confirm = (type: string, id: string, token: string = sup) => post(`/recovery-imports/${type}/${id}/confirm`, token)
  const receivables = (lines = [{ numero: 'FA-001', debtor: 'CLI-A', montant: '100,00' }, { numero: 'FB-001', debtor: 'CLI-B', montant: '900,00' }]) =>
    receivablesCsv(lines, EXTRACTION)
  const importReceivables = async (content = receivables(), total = '1 000,00') => {
    const { body } = await previewOf('receivables', content, total)
    expect(body.accepted).toBe(true)
    const res = await confirm('receivables', body.importId)
    expect(res.status).toBe(200)
    return { importId: body.importId as string, result: await res.json() }
  }

  beforeEach(async () => {
    await resetData()
    sup = (await accountWithProfile('sup@example.com', 'supervisor')).token
    sup2 = (await accountWithProfile('sup2@example.com', 'supervisor')).token
    lit = (await accountWithProfile('lit@example.com', 'litigation')).token
  })
  afterAll(closePool)

  it('[rule-recouvrement-import-supervisor-only] anonymous 401 and the other profiles 403 on every route', async () => {
    for (const path of ['/recovery-imports/history', '/recovery-imports/status', '/recovery-imports/receivables/specification', `/recovery-imports/receivables/${UNKNOWN}/errors`, `/recovery-imports/receivables/${UNKNOWN}/report`, `/recovery-imports/receivables/${UNKNOWN}/report/items?category=new`]) {
      expect((await get(path)).status).toBe(401)
      expect((await get(path, lit)).status).toBe(403)
    }
    expect((await upload('/recovery-imports/disputes/preview', 'a', lit)).status).toBe(403)
    expect((await post(`/recovery-imports/disputes/${UNKNOWN}/confirm`, lit)).status).toBe(403)
  })

  describe('GET /recovery-imports/:type/specification', () => {
    it.each(TYPES)('[rule-recouvrement-import-columns] %s: columns and limits', async (type) => {
      const body = await (await get(`/recovery-imports/${type}/specification`, sup)).json()
      expect(body.columns.length).toBeGreaterThan(0)
      expect(body.refusedOnFirstError).toBe(type === 'receivables' || type === 'payments')
      expect(body.extraFields.map((f: any) => f.name)).toEqual(type === 'receivables' ? ['controlTotal'] : [])
    })

    it('an unknown type is 400', async () => {
      expect((await get('/recovery-imports/autre/specification', sup)).status).toBe(400)
    })
  })

  describe('receivables', () => {
    it('[rule-recouvrement-import-control-total] the control total is required and must be well formed (400)', async () => {
      const missing = await previewOf('receivables', receivables())
      expect(missing.res.status).toBe(400)
      expect(missing.body.code).toBe('imports.control_total_required')
      const bad = await previewOf('receivables', receivables(), 'beaucoup')
      expect(bad.res.status).toBe(400)
      expect(bad.body.code).toBe('imports.control_total_invalid')
    })

    it('[rule-recouvrement-import-control-total] a total that differs refuses the whole file: accepted false, one error, nothing confirmable', async () => {
      const { res, body } = await previewOf('receivables', receivables(), '999,00')
      expect(res.status).toBe(200)
      expect(body).toMatchObject({ accepted: false, validRows: 0, errorRows: 1, computedTotalCents: 100000, controlTotalCents: 99900 })
      const errors = await (await get(`/recovery-imports/receivables/${body.importId}/errors`, sup)).json()
      expect(errors.total).toBe(1)
      expect(errors.errors[0]).toMatchObject({ row: 1, column: 'solde' })
      expect((await confirm('receivables', body.importId)).status).toBe(409)
    })

    it('[rule-recouvrement-import-green-light] the confirmation creates the cases and invoices, with their history, and is traced', async () => {
      const { importId, result } = await importReceivables()
      expect(result).toMatchObject({ createdCount: 2 })
      expect(await sql('select debtor_id, state from base.cases order by debtor_id')).toEqual([
        { debtor_id: 'CLI-A', state: 'open' },
        { debtor_id: 'CLI-B', state: 'open' },
      ])
      expect(await sql('select count(*)::int as n from base.case_state_history')).toEqual([{ n: 2 }])
      const [entry] = await sql("select object_type, object_id from base.audit_logs where action = 'recovery-imports:confirm'")
      expect(entry).toEqual({ object_type: 'Import de créances', object_id: importId })
      expect((await confirm('receivables', importId)).status).toBe(409)
    })

    it('[rule-recouvrement-import-report] the second report compares with the previous import: new, settled and modified cases', async () => {
      await importReceivables()
      const next = receivablesCsv(
        [
          { numero: 'FA-001', debtor: 'CLI-A', montant: '100,00', solde: '40,00' },
          { numero: 'FC-001', debtor: 'CLI-C', montant: '10,00' },
        ],
        '2026-10-02',
      )
      const { body } = await previewOf('receivables', next, '50,00')
      expect(body.accepted).toBe(true)
      const report = await (await get(`/recovery-imports/receivables/${body.importId}/report`, sup)).json()
      expect(report.previous).not.toBeNull()
      const cases = Object.fromEntries(report.categories.map((c: any) => [c.code, c.cases]))
      expect(cases).toMatchObject({ new: 1, settled: 1, modified: 1 })
      const items = await (await get(`/recovery-imports/receivables/${body.importId}/report/items?category=new&size=100`, sup)).json()
      expect(items.items.map((i: any) => i.debtorId)).toEqual(['CLI-C'])
      await confirm('receivables', body.importId)
      expect(await sql("select state from base.cases where debtor_id = 'CLI-B'")).toEqual([{ state: 'settled' }])
    })

    it('[rule-recouvrement-import-green-light] a preview is private: another supervisor gets 404 import.preview_not_found on errors, report and items', async () => {
      const { body } = await previewOf('receivables', receivables(), '1 000,00')
      for (const path of ['errors', 'report', 'report/items?category=new']) {
        const res = await get(`/recovery-imports/receivables/${body.importId}/${path}`, sup2)
        expect(res.status).toBe(404)
        expect((await res.json()).code).toBe('import.preview_not_found')
      }
      expect((await confirm('receivables', body.importId, sup2)).status).toBe(404)
    })

    it('report items need a valid category (400) and a known preview (404)', async () => {
      const { body } = await previewOf('receivables', receivables(), '1 000,00')
      expect((await get(`/recovery-imports/receivables/${body.importId}/report/items`, sup)).status).toBe(400)
      expect((await get(`/recovery-imports/receivables/${body.importId}/report/items?category=inconnue`, sup)).status).toBe(400)
      expect((await get(`/recovery-imports/receivables/${UNKNOWN}/report/items?category=new`, sup)).status).toBe(404)
    })
  })

  describe('payments', () => {
    const paymentsCsv = (rows: string[][], statement = '2026-10-10') =>
      csv([['reference', 'montant', 'date_paiement', 'date_releve'], ...rows.map(([reference, montant, date]) => [reference, montant, date, statement])])

    it('[rule-recouvrement-import-control-total] a control total is refused for the payments (400)', async () => {
      const { res } = await previewOf('payments', paymentsCsv([['VIR FA-001', '100,00', '2026-10-05']]), '100,00')
      expect(res.status).toBe(400)
    })

    it('[rule-recouvrement-lettrage-order] a payment dated after the extraction settles the invoice named in its reference', async () => {
      await importReceivables()
      const { body } = await previewOf('payments', paymentsCsv([['VIR FA-001 octobre', '100,00', '2026-10-05']]))
      expect(body).toMatchObject({ accepted: true, validRows: 1 })
      const res = await confirm('payments', body.importId)
      expect(res.status).toBe(200)
      expect(await sql("select balance_cents from base.invoices where number = 'FA-001'")).toEqual([{ balance_cents: '0' }])
      expect(await sql("select state from base.cases where debtor_id = 'CLI-A'")).toEqual([{ state: 'settled' }])
      const [entry] = await sql("select object_type from base.audit_logs where action = 'recovery-imports:confirm' and object_id = $1", [body.importId])
      expect(entry.object_type).toBe('Import de paiements')
    })

    it('[rule-recouvrement-import-green-light] a payment reference already known is skipped, never counted twice', async () => {
      await importReceivables()
      const first = await previewOf('payments', paymentsCsv([['VIR FA-001', '30,00', '2026-10-05']]))
      await confirm('payments', first.body.importId)
      const second = await previewOf('payments', paymentsCsv([['VIR FA-001', '30,00', '2026-10-05'], ['VIR FA-001 bis', '0,01', '2026-10-06']]))
      expect(second.body.accepted).toBe(true)
      const result = await (await confirm('payments', second.body.importId)).json()
      expect(result).toMatchObject({ createdCount: 1, skippedCount: 1 })
      expect(await sql("select balance_cents from base.invoices where number = 'FA-001'")).toEqual([{ balance_cents: '6999' }])
    })
  })

  describe('disputes, contacts and documents (valid rows are imported)', () => {
    beforeEach(async () => {
      await importReceivables()
    })

    it('[rule-recouvrement-disputes-import-freeze] each valid row opens a dispute and freezes the invoice; the invalid row is listed and stays listed after the confirmation', async () => {
      const file = csv([
        ['numero', 'entite_siren', 'motif', 'responsable', 'date_ouverture'],
        ['FA-001', null, 'Facture contestée', 'Marie', '2026-09-30'],
        ['INCONNUE', null, 'Motif', 'Marie', '2026-09-30'],
      ])
      const { body } = await previewOf('disputes', file)
      expect(body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1, accepted: true })
      const result = await (await confirm('disputes', body.importId)).json()
      expect(result.createdCount).toBe(1)
      expect(await sql('select origin, opened_by from base.disputes')).toEqual([{ origin: 'import', opened_by: expect.any(String) }])
      expect(await sql("select count(*)::int as n from base.freezes where code = 'dispute' and released_at is null")).toEqual([{ n: 1 }])
      const errors = await (await get(`/recovery-imports/disputes/${body.importId}/errors`, sup)).json()
      expect(errors).toMatchObject({ total: 1, errors: [{ row: 3, column: 'numero' }] })
      const [entry] = await sql("select object_type from base.audit_logs where action = 'recovery-imports:confirm' and object_id = $1", [body.importId])
      expect(entry.object_type).toBe("Import de litiges")
    })

    it('[rule-recouvrement-disputes-import-additive] an invoice already in an open dispute is skipped', async () => {
      const file = csv([['numero', 'entite_siren', 'motif', 'responsable', 'date_ouverture'], ['FA-001', null, 'Motif', 'Marie', '2026-09-30']])
      await confirm('disputes', (await previewOf('disputes', file)).body.importId)
      const again = await previewOf('disputes', csv([['numero', 'entite_siren', 'motif', 'responsable', 'date_ouverture'], ['FA-001', null, 'Autre motif', 'Paul', '2026-09-30']]))
      expect(await (await confirm('disputes', again.body.importId)).json()).toMatchObject({ createdCount: 0, skippedCount: 1 })
    })

    it('[rule-recouvrement-disputes-import-additive][rule-recouvrement-import-report] the same invoice twice in one file: the preview answers, the report counts it once, one dispute is opened and one row is skipped', async () => {
      const file = csv([
        ['numero', 'entite_siren', 'motif', 'responsable', 'date_ouverture'],
        ['FA-001', null, 'Premier motif', 'Marie', '2026-09-30'],
        ['FA-001', null, 'Second motif', 'Paul', '2026-09-30'],
      ])
      const { res, body } = await previewOf('disputes', file)
      expect(res.status).toBe(200)
      expect(body).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 })
      const items = await (await get(`/recovery-imports/disputes/${body.importId}/report/items?category=new`, sup)).json()
      expect(items.total).toBe(1)
      const result = await (await confirm('disputes', body.importId)).json()
      expect(result).toMatchObject({ createdCount: 1, skippedCount: 1 })
      expect(result.effects).toEqual(expect.arrayContaining([{ label: 'Factures gelées', count: 1 }, { label: 'Dossiers gelés', count: 1 }]))
    })

    it('[rule-recouvrement-contacts-columns] the confirmation replaces the whole set of contacts and flags an invalid coordinate', async () => {
      const header = ['debiteur_id', 'role', 'courriel', 'telephone', 'adresse_postale']
      const first = await previewOf('contacts', csv([header, ['CLI-A', 'payeur', 'a@example.com', null, null], ['CLI-B', 'payeur', 'pas-un-courriel', null, null]]))
      expect(first.body).toMatchObject({ validRows: 2, errorRows: 0 })
      await confirm('contacts', first.body.importId)
      expect(await sql('select suspended_channels from base.contacts order by suspended_channels')).toEqual([{ suspended_channels: [] }, { suspended_channels: ['email_sms'] }])
      const second = await previewOf('contacts', csv([header, ['CLI-A', 'payeur', 'a@example.com', '0102030405', null], ['CLI-A', 'acheteur', 'v@example.com', null, null]]))
      expect(second.body).toMatchObject({ validRows: 1, errorRows: 1 })
      await confirm('contacts', second.body.importId)
      expect(await sql('select count(*)::int as n from base.contacts')).toEqual([{ n: 1 }])
    })

    it('[rule-recouvrement-documents-columns] the confirmation replaces the whole index of documents; a repeated (invoice, type) is ignored', async () => {
      const header = ['numero', 'entite_siren', 'type', 'reference']
      const { body } = await previewOf('documents', csv([header, ['FA-001', null, 'contrat', 'C-1'], ['FA-001', null, 'contrat', 'C-2'], ['FA-001', null, 'inconnu', null]]))
      expect(body).toMatchObject({ validRows: 2, errorRows: 1 })
      await confirm('documents', body.importId)
      expect(await sql('select type, reference from base.invoice_documents')).toEqual([{ type: 'contract', reference: 'C-1' }])
    })

    it('a control total is refused for the row-by-row files (400)', async () => {
      const { res } = await previewOf('contacts', csv([['debiteur_id', 'role'], ['CLI-A', 'payeur']]), '10,00')
      expect(res.status).toBe(400)
    })
  })

  describe('GET /recovery-imports/history and /recovery-imports/status', () => {
    it('[rule-recouvrement-import-history] lists the confirmed imports newest first, filters by type, and rejects a bad query', async () => {
      const { importId } = await importReceivables()
      const body = await (await get('/recovery-imports/history', sup)).json()
      expect(body.total).toBe(1)
      expect(body.items[0]).toMatchObject({ importId, type: 'receivables', createdCount: 2, confirmedBy: { email: 'sup@example.com' } })
      expect((await (await get('/recovery-imports/history?type=payments', sup)).json()).total).toBe(0)
      expect((await get('/recovery-imports/history?type=autre', sup)).status).toBe(400)
      expect((await get('/recovery-imports/history?size=0', sup)).status).toBe(400)
    })

    it('[rule-recouvrement-statement-fresh] without statement nor policy: no date, never fresh; after the receivables: the extraction date', async () => {
      expect(await (await get('/recovery-imports/status', sup)).json()).toEqual({
        statement: { lastStatementDate: null, maxAgeDays: null, fresh: false },
        receivablesExtractionDate: null,
        lastConfirmed: [],
      })
      await importReceivables()
      const status = await (await get('/recovery-imports/status', sup)).json()
      expect(status.receivablesExtractionDate).toBe(EXTRACTION)
      expect(status.lastConfirmed.map((l: any) => l.type)).toEqual(['receivables'])
      expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })
})
