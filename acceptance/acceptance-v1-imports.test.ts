import { resetData, closePool, sql } from './harness'
import { upload } from './import-helpers'
import {
  World, get, post, expectRes, ok, UNKNOWN_UUID, runImport, strip, euros, daysFromToday, today, addDays, setupWorld, importReceivables,
  importPayments, importOk, receivablesFile, receivablesTotal, receivableRow, RECEIVABLES_HEADER, PAYMENTS_HEADER, CONTACTS_HEADER,
  contactsFile, defaultContact, DISPUTES_HEADER, DOCUMENTS_HEADER, errorEntries, paymentsFile, policyDoc, activatePolicy, SIREN_A, SIREN_B,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : les cinq fichiers pivot (Créances, Paiements, Litiges, Interlocuteurs, Pièces),
// aperçu, erreurs, rapport d'écarts, confirmation (feu vert), lettrage, statut du relevé.

const D = (n: number) => daysFromToday(n)
const col = (name: string) => RECEIVABLES_HEADER.indexOf(name)

describe('Recouvrement - imports', () => {
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

  const BASE: Inv[] = [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }]
  const previewRec = (rows: Inv[], extraction = D(-3), total?: string) =>
    runImport(sup, 'receivables', receivablesFile(rows, extraction), { controlTotal: total ?? euros(receivablesTotal(rows)), confirm: false })

  /** Aperçu d'un fichier de créances dont on modifie des cellules de la première ligne. */
  async function previewMutated(mutate: (row: (string | number)[]) => void, rows: Inv[] = BASE, total?: string) {
    const body = rows.map((r) => receivableRow(r, D(-3)))
    mutate(body[0])
    const file = strip([RECEIVABLES_HEADER, ...body])
    return runImport(sup, 'receivables', file, { controlTotal: total ?? euros(receivablesTotal(rows)), confirm: false })
  }

  async function expectRefused(run: { pre: any }, column: string | string[], row = 2) {
    expectRes(run.pre, 200)
    expect(run.pre.body.accepted).toBe(false)
    expect(run.pre.body.errorRows).toBe(1)
    const errors = await get(`/recovery-imports/receivables/${run.pre.body.importId}/errors`, sup)
    expectRes(errors, 200)
    const entries = errorEntries(errors.body)
    expect(entries).toHaveLength(1)
    expect(errors.body.total).toBe(1)
    expect(Array.isArray(column) ? column : [column]).toContain(entries[0].column)
    expect(entries[0].row).toBe(row)
    expect(entries[0].reason.length).toBeGreaterThan(0)
    expect(entries[0].reason.length).toBeLessThanOrEqual(500)
    const conf = await post(`/recovery-imports/receivables/${run.pre.body.importId}/confirm`, sup)
    expectRes(conf, 409, 'imports.file_refused')
    expect(await sql('select 1 from base.cases')).toHaveLength(0)
    return entries[0]
  }

  describe('spécification des fichiers', () => {
    const COLUMNS: Record<string, [string, boolean][]> = {
      receivables: [
        ['type_piece', true], ['numero', true], ['entite_siren', true], ['debiteur_id', true], ['debiteur_nature', true], ['debiteur_siren', false],
        ['payeur', false], ['montant', true], ['solde', true], ['date_facture', true], ['echeance', true], ['segment', true], ['canaux', false],
        ['date_extraction', true], ['reference_sortie', false],
      ],
      payments: [['reference', true], ['montant', true], ['date_paiement', true], ['date_releve', true]],
      disputes: [['numero', true], ['entite_siren', false], ['motif', true], ['responsable', true], ['date_ouverture', true]],
      contacts: [['debiteur_id', true], ['role', true], ['courriel', false], ['telephone', false], ['adresse_postale', false]],
      documents: [['numero', true], ['entite_siren', false], ['type', true], ['reference', false]],
    }
    for (const [type, columns] of Object.entries(COLUMNS)) {
      it(`[rule-recouvrement-import-pivot-format] the specification of ${type} lists the columns of the pivot format with their required flag, the limits and the refusal mode`, async () => {
        const res = await get(`/recovery-imports/${type}/specification`, sup)
        expectRes(res, 200)
        expect(res.body.columns.map((c: any) => [c.name, c.required])).toEqual(columns)
        for (const c of res.body.columns) expect(typeof c.description).toBe('string')
        expect(res.body.maxFileSizeBytes).toBe(104857600)
        expect(res.body.maxRows).toBe(1000000)
        expect(res.body.acceptedExtensions).toEqual(['.xlsx', '.csv'])
        expect(res.body.refusedOnFirstError).toBe(type === 'receivables' || type === 'payments')
        expect(Array.isArray(res.body.extraFields)).toBe(true)
        expect(res.body.extraFields.length).toBeLessThanOrEqual(5)
      })
    }

    it('[rule-recouvrement-import-pivot-format] an unknown file type answers 400', async () => {
      expectRes(await get('/recovery-imports/inconnu/specification', sup), 400, 'api.validation.incoming_failed')
      expectRes(await get(`/recovery-imports/inconnu/${UNKNOWN_UUID}/errors`, sup), 400, 'api.validation.incoming_failed')
    })
  })

  describe('Créances : aperçu et refus entier', () => {
    it('[rule-recouvrement-import-pivot-format][rule-recouvrement-import-green-light] a valid file gives an accepted preview with the computed and the entered totals and writes no business data before the confirmation', async () => {
      const rows: Inv[] = [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
        { numero: 'FA-002', debiteur: 'D1', montant: 50000, solde: 30000 },
        { numero: 'AV-001', debiteur: 'D1', montant: -20000, type: 'avoir' },
      ]
      const run = await previewRec(rows)
      expectRes(run.pre, 200)
      expect(run.pre.body).toMatchObject({ fileName: 'receivables.csv', totalRows: 3, validRows: 3, errorRows: 0, accepted: true, computedTotalCents: 110000, controlTotalCents: 110000 })
      expect(run.pre.body.importId).toMatch(/^[0-9a-f-]{36}$/)
      expect(await sql('select 1 from base.cases')).toHaveLength(0)
      expect(await sql('select 1 from base.invoices')).toHaveLength(0)
      expect(ok(await get('/cases', sup)).total).toBe(0)
    })

    it('[rule-recouvrement-money-cents][rule-recouvrement-import-pivot-format] amounts with a comma decimal and spaces as thousands separators, and dates written JJ/MM/AAAA, are read exactly', async () => {
      const row = receivableRow(BASE[0], D(-3))
      row[col('montant')] = '1 234,50'
      row[col('solde')] = '1 234,50'
      const dueIso = row[col('echeance')] as string
      const [y, m, d] = dueIso.split('-')
      row[col('echeance')] = `${d}/${m}/${y}`
      const file = strip([RECEIVABLES_HEADER, row])
      const run = await runImport(sup, 'receivables', file, { controlTotal: '1234.50' })
      expectRes(run.pre, 200)
      expect(run.pre.body).toMatchObject({ accepted: true, errorRows: 0, computedTotalCents: 123450, controlTotalCents: 123450 })
      expectRes(run.conf!, 200)
      const detail = await w.caseDetail('D1')
      expect(detail.invoices[0]).toMatchObject({ number: 'FA-001', amountCents: 123450, balanceCents: 123450, dueDate: dueIso })
    })

    it('[rule-recouvrement-receivables-control-total] the control total is a query parameter: absent gives 400 imports.control_total_required, unreadable 400 imports.control_total_invalid', async () => {
      const file = receivablesFile(BASE, D(-3))
      expectRes((await runImport(sup, 'receivables', file, { confirm: false })).pre, 400, 'imports.control_total_required')
      for (const bad of ['abc', '12.345', '1e5', '--3', '1,2,3']) {
        const run = await runImport(sup, 'receivables', file, { controlTotal: bad, confirm: false })
        expect(`${bad}:${run.pre.status}:${run.pre.body?.code}`).toBe(`${bad}:400:imports.control_total_invalid`)
      }
    })

    it('[rule-recouvrement-receivables-control-total] spaces are ignored and a comma decimal is read: « 1 000,00 » is the total of a 1 000,00 file', async () => {
      const run = await runImport(sup, 'receivables', receivablesFile(BASE, D(-3)), { controlTotal: '1 000,00', confirm: false })
      expectRes(run.pre, 200)
      expect(run.pre.body).toMatchObject({ accepted: true, controlTotalCents: 100000 })
    })

    it('[rule-recouvrement-receivables-control-total] the control total is refused for the other file types: 400 api.validation.incoming_failed', async () => {
      const run = await runImport(sup, 'payments', paymentsFile([{ reference: 'P1', montant: 100 }]), { controlTotal: '1.00', confirm: false })
      expectRes(run.pre, 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-receivables-control-total][rule-recouvrement-import-refuse-whole] a total of the balances different from the entered control total refuses the whole file: one error on row 1, column solde, accepted false, confirmation 409 imports.file_refused', async () => {
      const run = await previewRec(BASE, D(-3), '999.99')
      expectRes(run.pre, 200)
      expect(run.pre.body).toMatchObject({ accepted: false, errorRows: 1, computedTotalCents: 100000, controlTotalCents: 99999 })
      const entry = await expectRefused(run, 'solde', 1)
      expect(entry.reason).toMatch(/diffère du total de contrôle/)
    })

    it('[rule-recouvrement-receivables-control-total] credit notes count negatively in the total of the balances', async () => {
      const rows: Inv[] = [BASE[0], { numero: 'AV-001', debiteur: 'D1', montant: -20000, type: 'avoir' }]
      expect((await previewRec(rows, D(-3), '800.00')).pre.body.accepted).toBe(true)
      expect((await previewRec(rows, D(-3), '1200.00')).pre.body.accepted).toBe(false)
    })

    it('[rule-recouvrement-receivables-duplicate-number][rule-recouvrement-import-refuse-whole] a number repeated for the same creditor entity refuses the whole file with one error naming the first row', async () => {
      const rows: Inv[] = [BASE[0], { numero: 'FA-002', debiteur: 'D2', montant: 1000 }, { numero: 'FA-001', debiteur: 'D3', montant: 2000 }]
      const run = await previewRec(rows)
      const entry = await expectRefused(run, 'numero', 4)
      expect(entry.reason).toBe('Numéro déjà présent à la ligne 2 pour cette entité.')
    })

    it('[rule-recouvrement-receivables-duplicate-number] the same number for two different creditor entities is not a duplicate', async () => {
      const rows: Inv[] = [BASE[0], { numero: 'FA-001', debiteur: 'D2', montant: 2000, entite: SIREN_B }]
      const run = await previewRec(rows)
      expect(run.pre.body).toMatchObject({ accepted: true, errorRows: 0 })
    })

    const REFUSED: [string, string, (r: (string | number)[]) => void][] = [
      ['unknown piece type', 'type_piece', (r) => (r[col('type_piece')] = 'bon')],
      ['empty number', 'numero', (r) => (r[col('numero')] = '')],
      ['number of 51 characters', 'numero', (r) => (r[col('numero')] = 'N'.repeat(51))],
      ['creditor SIREN of 8 digits', 'entite_siren', (r) => (r[col('entite_siren')] = '12345678')],
      ['missing creditor SIREN', 'entite_siren', (r) => (r[col('entite_siren')] = '')],
      ['missing debtor id', 'debiteur_id', (r) => (r[col('debiteur_id')] = '')],
      ['debtor id of 51 characters', 'debiteur_id', (r) => (r[col('debiteur_id')] = 'D'.repeat(51))],
      ['unknown debtor nature', 'debiteur_nature', (r) => (r[col('debiteur_nature')] = 'asso')],
      ['company without SIREN', 'debiteur_siren', (r) => { r[col('debiteur_nature')] = 'entreprise'; r[col('debiteur_siren')] = '' }],
      ['company with a SIREN of 8 digits', 'debiteur_siren', (r) => { r[col('debiteur_nature')] = 'entreprise'; r[col('debiteur_siren')] = '12345678' }],
      ['family with a SIREN', 'debiteur_siren', (r) => (r[col('debiteur_siren')] = '443061841')],
      ['payer of 101 characters', 'payeur', (r) => (r[col('payeur')] = 'P'.repeat(101))],
      ['invoice with a zero amount', 'montant', (r) => (r[col('montant')] = '0.00')],
      ['invoice with a negative amount', 'montant', (r) => { r[col('montant')] = '-10.00'; r[col('solde')] = '-10.00' }],
      ['credit note with a positive amount', 'montant', (r) => { r[col('type_piece')] = 'avoir'; r[col('montant')] = '100.00'; r[col('solde')] = '0.00' }],
      ['amount above 10 000 000 000 cents', 'montant', (r) => { r[col('montant')] = '100000000.01'; r[col('solde')] = '100000000.01' }],
      ['amount with three decimals', 'montant', (r) => (r[col('montant')] = '1000.005')],
      ['amount that is not a number', 'montant', (r) => (r[col('montant')] = 'mille')],
      ['balance above the amount', 'solde', (r) => (r[col('solde')] = '1000.01')],
      ['negative balance on an invoice', 'solde', (r) => (r[col('solde')] = '-1.00')],
      ['positive balance on a credit note', 'solde', (r) => { r[col('type_piece')] = 'avoir'; r[col('montant')] = '-100.00'; r[col('solde')] = '1.00' }],
      ['credit note balance below its amount', 'solde', (r) => { r[col('type_piece')] = 'avoir'; r[col('montant')] = '-100.00'; r[col('solde')] = '-100.01' }],
      ['unreadable invoice date', 'date_facture', (r) => (r[col('date_facture')] = 'hier')],
      ['impossible invoice date', 'date_facture', (r) => (r[col('date_facture')] = '2026-02-30')],
      ['due date before the invoice date', 'echeance', (r) => { r[col('date_facture')] = '2026-06-10'; r[col('echeance')] = '2026-06-09' }],
      ['segment with a capital', 'segment', (r) => (r[col('segment')] = 'Standard')],
      ['empty segment', 'segment', (r) => (r[col('segment')] = '')],
      ['segment of 51 characters', 'segment', (r) => (r[col('segment')] = 'a'.repeat(51))],
      ['unknown channel', 'canaux', (r) => (r[col('canaux')] = 'voix;sms')],
      ['extraction date in the future', 'date_extraction', (r) => (r[col('date_extraction')] = D(1))],
      ['reference of an output of 31 characters', 'reference_sortie', (r) => (r[col('reference_sortie')] = 'S'.repeat(31))],
    ]
    for (const [name, column, mutate] of REFUSED) {
      it(`[rule-recouvrement-import-refuse-whole][rule-recouvrement-debtor-siren] ${name}: the whole file is refused with one error on row 2, column ${column}`, async () => {
        const rows: Inv[] = [BASE[0], { numero: 'FA-002', debiteur: 'D2', montant: 5000 }]
        const run = await previewMutated(mutate, rows, euros(receivablesTotal(rows)))
        await expectRefused(run, column)
      })
    }

    it('[rule-recouvrement-import-refuse-whole] a file with several faulty rows is refused at the first error: errorRows 1 and a single entry', async () => {
      const body = [receivableRow(BASE[0], D(-3)), receivableRow({ numero: 'FA-002', debiteur: 'D2', montant: 5000 }, D(-3)), receivableRow({ numero: 'FA-003', debiteur: 'D3', montant: 5000 }, D(-3))]
      body[0][col('segment')] = 'Mauvais'
      body[1][col('montant')] = '0'
      body[2][col('canaux')] = 'pigeon'
      const run = await runImport(sup, 'receivables', strip([RECEIVABLES_HEADER, ...body]), { controlTotal: '1.00', confirm: false })
      await expectRefused(run, 'segment')
    })

    it('[rule-recouvrement-receivables-extraction-date] the extraction date must be the same on every row', async () => {
      const rows: Inv[] = [BASE[0], { numero: 'FA-002', debiteur: 'D2', montant: 5000 }]
      const body = rows.map((r) => receivableRow(r, D(-3)))
      body[1][col('date_extraction')] = D(-2)
      const run = await runImport(sup, 'receivables', strip([RECEIVABLES_HEADER, ...body]), { controlTotal: euros(receivablesTotal(rows)), confirm: false })
      await expectRefused(run, 'date_extraction', 3)
    })

    it('[rule-recouvrement-receivables-extraction-date] an extraction date older than the last confirmed snapshot is refused', async () => {
      await importReceivables(sup, BASE, D(-3))
      const run = await runImport(sup, 'receivables', receivablesFile([{ numero: 'FA-009', debiteur: 'D9', montant: 100 }], D(-6)), { controlTotal: '1.00', confirm: false })
      expectRes(run.pre, 200)
      expect(run.pre.body.accepted).toBe(false)
      const entries = errorEntries((await get(`/recovery-imports/receivables/${run.pre.body.importId}/errors`, sup)).body)
      expect(entries).toHaveLength(1)
      expect(entries[0].column).toBe('date_extraction')
    })

    it('[rule-recouvrement-receivables-extraction-date] a snapshot made stale between its preview and its confirmation is refused: 409 imports.stale_extraction, nothing changes', async () => {
      const older = await previewRec([{ numero: 'FA-OLD', debiteur: 'D8', montant: 100 }], D(-6))
      const newer = await previewRec(BASE, D(-3))
      expectRes(await post(`/recovery-imports/receivables/${newer.pre.body.importId}/confirm`, sup), 200)
      expectRes(await post(`/recovery-imports/receivables/${older.pre.body.importId}/confirm`, sup), 409, 'imports.stale_extraction')
      expect(ok(await get('/cases?size=100', sup)).items.map((c: any) => c.debtorId)).toEqual(['D1'])
    })

    it('[rule-recouvrement-receivables-case-grouping] every row of a debtor carries the same nature, SIREN and segment, otherwise the file is refused', async () => {
      const mk = (over: Partial<Inv>): Inv[] => [BASE[0], { numero: 'FA-002', debiteur: 'D1', montant: 5000, ...over }]
      const seg = await previewRec(mk({ segment: 'premium' }))
      const entry = await expectRefused(seg, 'segment', 3)
      expect(entry.reason).toBe('Le segment diffère de celui de la ligne 2 pour ce débiteur.')
      await expectRefused(await previewRec(mk({ nature: 'entreprise' })), ['debiteur_nature', 'debiteur_siren'], 3)
      const company: Inv[] = [
        { numero: 'FA-001', debiteur: 'DC', montant: 1000, nature: 'entreprise' },
        { numero: 'FA-002', debiteur: 'DC', montant: 1000, nature: 'entreprise', debiteurSiren: '732829320' },
      ]
      await expectRefused(await previewRec(company), 'debiteur_siren', 3)
    })

    it('[rule-recouvrement-receivables-case-grouping][rule-recouvrement-debtor-attributes][rule-recouvrement-case-grouping][rule-recouvrement-debtor-siren] one case per customer id groups the invoices of several creditor entities; the case carries nature, segment and, for a company only, the SIREN', async () => {
      const rows: Inv[] = [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000, entite: SIREN_B },
        { numero: 'FA-002', debiteur: 'D1', montant: 50000, entite: SIREN_A },
        { numero: 'FA-003', debiteur: 'DC', montant: 70000, nature: 'entreprise', segment: 'premium' },
      ]
      await importReceivables(sup, rows, D(-3))
      const list = ok(await get('/cases?size=100', sup))
      expect(list.total).toBe(2)
      const d1 = list.items.find((c: any) => c.debtorId === 'D1')
      expect(d1).toMatchObject({ nature: 'family', segment: 'standard', creditors: [SIREN_A, SIREN_B].sort(), state: 'open', openInvoices: 2 })
      const detail = await w.caseDetail('D1')
      expect(detail.debtorSiren).toBeNull()
      expect(detail.invoices.map((i: any) => [i.number, i.creditorSiren])).toEqual(expect.arrayContaining([['FA-001', SIREN_B], ['FA-002', SIREN_A]]))
      const dc = await w.caseDetail('DC')
      expect(dc).toMatchObject({ nature: 'company', segment: 'premium', debtorSiren: '443061841' })
    })
  })

  describe('Créances : confirmation, cliché, rapport', () => {
    it('[rule-recouvrement-receivables-snapshot][rule-recouvrement-import-green-light] the confirmation replaces the portfolio: cases and invoices are created, with a creation transition and the effects listed', async () => {
      const rows: Inv[] = [BASE[0], { numero: 'FA-002', debiteur: 'D2', montant: 5000 }]
      const run = await runImport(sup, 'receivables', receivablesFile(rows, D(-3)), { controlTotal: euros(receivablesTotal(rows)) })
      expectRes(run.conf!, 200)
      expect(run.conf!.body.createdCount).toBeGreaterThanOrEqual(2)
      expect(typeof run.conf!.body.skippedCount).toBe('number')
      expect(Array.isArray(run.conf!.body.effects)).toBe(true)
      expect(run.conf!.body.effects.length).toBeLessThanOrEqual(20)
      for (const e of run.conf!.body.effects) {
        expect(typeof e.label).toBe('string')
        expect(Number.isInteger(e.count)).toBe(true)
      }
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('open')
      expect(detail.invoices[0]).toMatchObject({ number: 'FA-001', kind: 'invoice', amountCents: 100000, balanceCents: 100000, creditorSiren: SIREN_A, frozen: false, negotiable: true })
      const history = ok(await get(`/cases/${detail.id}/state-history`, sup))
      expect(history.items[0]).toMatchObject({ from: null, to: 'open', cause: 'import' })
    })

    it('[rule-recouvrement-receivables-snapshot][rule-recouvrement-closed-case-only-invoices] a following snapshot updates balances, adds invoices, closes absent invoices (balance 0), settles absent debtors and reopens a settled case when an invoice reappears', async () => {
      await importReceivables(sup, [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
        { numero: 'FA-002', debiteur: 'D1', montant: 50000 },
        { numero: 'FA-003', debiteur: 'D2', montant: 30000 },
      ], D(-6))
      const d2Id = await w.caseId('D2')
      await importReceivables(sup, [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000, solde: 60000 },
        { numero: 'FA-004', debiteur: 'D1', montant: 10000 },
        { numero: 'FA-005', debiteur: 'D3', montant: 20000 },
      ], D(-5))
      const d1 = await w.caseDetail('D1')
      const byNumber = Object.fromEntries(d1.invoices.map((i: any) => [i.number, i.balanceCents]))
      expect(byNumber).toMatchObject({ 'FA-001': 60000, 'FA-004': 10000 })
      expect(byNumber['FA-002'] ?? 0).toBe(0)
      expect(d1.negotiableCents).toBe(70000)
      expect(d1.state).toBe('open')
      const d2 = ok(await get(`/cases/${d2Id}`, sup)).case
      expect(d2.state).toBe('settled')
      expect((await w.caseDetail('D3')).state).toBe('open')
      await importReceivables(sup, [{ numero: 'FA-006', debiteur: 'D2', montant: 9000 }], D(-4))
      const reopened = ok(await get(`/cases/${d2Id}`, sup)).case
      expect(reopened.state).toBe('open')
      const history = ok(await get(`/cases/${d2Id}/state-history`, sup)).items
      expect(history.map((h: any) => [h.from, h.to, h.cause])).toEqual([['settled', 'open', 'import'], ['open', 'settled', 'balance_cleared'], [null, 'open', 'import']])
    })

    it('[rule-recouvrement-closed-case-only-invoices] a case whose only open piece is a credit note is settled; an open credit note keeps its negative balance on the card', async () => {
      await importReceivables(sup, [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000, solde: 0 },
        { numero: 'AV-001', debiteur: 'D1', montant: -20000, type: 'avoir' },
      ], D(-3))
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('settled')
      expect(detail.invoices.find((i: any) => i.number === 'AV-001')).toMatchObject({ kind: 'credit_note', balanceCents: -20000 })
    })

    it('[rule-recouvrement-import-report] the first report has no previous import and counts every case as new; the report is readable at the preview and after the confirmation', async () => {
      const rows: Inv[] = [BASE[0], { numero: 'FA-002', debiteur: 'D2', montant: 5000 }]
      const run = await runImport(sup, 'receivables', receivablesFile(rows, D(-3)), { controlTotal: euros(receivablesTotal(rows)) })
      const id = run.pre.body.importId
      const report = ok(await get(`/recovery-imports/receivables/${id}/report`, sup))
      expect(report).toMatchObject({ type: 'receivables', importId: id, previous: null })
      expect(report.categories.map((c: any) => c.code)).toEqual(expect.arrayContaining(['new', 'settled', 'modified']))
      expect(report.categories.find((c: any) => c.code === 'new').cases).toBe(2)
      expect(report.categories.find((c: any) => c.code === 'settled').cases).toBe(0)
      for (const c of report.categories) {
        expect(c.label.length).toBeGreaterThan(0)
        expect(Number.isInteger(c.rows)).toBe(true)
      }
      expectRes(await get(`/recovery-imports/receivables/${id}/report`, sup), 200)
    })

    it('[rule-recouvrement-import-report] the second report compares with the last confirmed import of the same type: new, settled and modified cases, items by category sorted by key', async () => {
      const first = await runImport(sup, 'receivables', receivablesFile([
        { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
        { numero: 'FA-002', debiteur: 'D2', montant: 30000 },
        { numero: 'FA-003', debiteur: 'D4', montant: 30000 },
      ], D(-6)), { controlTotal: '1600.00' })
      expectRes(first.conf!, 200)
      const rows: Inv[] = [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000, solde: 60000 },
        { numero: 'FA-003', debiteur: 'D4', montant: 30000 },
        { numero: 'FA-005', debiteur: 'D3', montant: 20000 },
      ]
      const second = await runImport(sup, 'receivables', receivablesFile(rows, D(-5)), { controlTotal: euros(receivablesTotal(rows)), confirm: false })
      const id = second.pre.body.importId
      const report = ok(await get(`/recovery-imports/receivables/${id}/report`, sup))
      expect(report.previous).toMatchObject({ importId: first.pre.body.importId, fileName: 'receivables.csv' })
      expect(report.previous.confirmedAt).toBeTruthy()
      const cases = Object.fromEntries(report.categories.map((c: any) => [c.code, c.cases]))
      expect(cases).toMatchObject({ new: 1, settled: 1, modified: 1 })
      for (const category of ['new', 'settled', 'modified']) {
        const items = ok(await get(`/recovery-imports/receivables/${id}/report/items?category=${category}&size=100`, sup))
        expect(items.total).toBeGreaterThanOrEqual(1)
        const keys = items.items.map((i: any) => i.key)
        expect(keys).toEqual([...keys].sort())
        for (const it of items.items) {
          expect(it.key.length).toBeGreaterThan(0)
          expect(typeof it.detail).toBe('string')
          expect(it.detail.length).toBeGreaterThan(0)
        }
      }
      const added = ok(await get(`/recovery-imports/receivables/${id}/report/items?category=new`, sup))
      expect(added.items.map((i: any) => i.debtorId)).toContain('D3')
      const settled = ok(await get(`/recovery-imports/receivables/${id}/report/items?category=settled`, sup))
      expect(settled.items.map((i: any) => i.debtorId)).toContain('D2')
      expectRes(await post(`/recovery-imports/receivables/${id}/confirm`, sup), 200)
    })

    it('[rule-recouvrement-import-report] the report writes no business data: the portfolio is unchanged after the preview', async () => {
      await importReceivables(sup, BASE, D(-6))
      const before = await sql('select count(*)::int as n, coalesce(sum(balance_cents), 0)::bigint as s from base.invoices')
      await previewRec([{ numero: 'FA-777', debiteur: 'D7', montant: 777 }], D(-5))
      expect(await sql('select count(*)::int as n, coalesce(sum(balance_cents), 0)::bigint as s from base.invoices')).toEqual(before)
    })

    it('[rule-recouvrement-import-report] report items need a valid category and answer 404 for an unknown preview', async () => {
      const run = await previewRec(BASE)
      const id = run.pre.body.importId
      expectRes(await get(`/recovery-imports/receivables/${id}/report/items?category=inconnue`, sup), 400, 'api.validation.incoming_failed')
      expectRes(await get(`/recovery-imports/receivables/${id}/report/items`, sup), 400, 'api.validation.incoming_failed')
      expectRes(await get(`/recovery-imports/receivables/${UNKNOWN_UUID}/report`, sup), 404, 'import.preview_not_found')
      expectRes(await get(`/recovery-imports/receivables/${UNKNOWN_UUID}/report/items?category=new`, sup), 404, 'import.preview_not_found')
    })

    it('[rule-recouvrement-import-no-double][rule-recouvrement-import-green-light] a file confirmed once is refused again: 409 import.already_imported at the preview and at the confirmation of another preview of the same file', async () => {
      const file = receivablesFile(BASE, D(-3))
      const a = await runImport(sup, 'receivables', file, { controlTotal: '1000.00', confirm: false })
      const b = await runImport(sup, 'receivables', file, { controlTotal: '1000.00', confirm: false })
      expectRes(await post(`/recovery-imports/receivables/${a.pre.body.importId}/confirm`, sup), 200)
      expectRes(await post(`/recovery-imports/receivables/${b.pre.body.importId}/confirm`, sup), 409, 'import.already_imported')
      expectRes((await runImport(sup, 'receivables', file, { controlTotal: '1000.00', confirm: false })).pre, 409, 'import.already_imported')
      expectRes(await post(`/recovery-imports/receivables/${a.pre.body.importId}/confirm`, sup), 409, 'import.already_imported')
    })

    it('[rule-recouvrement-import-green-light] another supervisor listing the errors of a preview gets the same 404 import.preview_not_found as for an unknown id', async () => {
      const run = await previewRec(BASE, D(-3), '1.00')
      const other = await w.tok('sup2')
      const foreign = await get(`/recovery-imports/receivables/${run.pre.body.importId}/errors`, other)
      const unknown = await get(`/recovery-imports/receivables/${UNKNOWN_UUID}/errors`, other)
      expectRes(foreign, 404, 'import.preview_not_found')
      expect(foreign.body).toEqual(unknown.body)
    })

    it('[rule-recouvrement-import-green-light] another supervisor reading the report or the report items of a preview gets the same 404 import.preview_not_found as for an unknown id', async () => {
      const run = await previewRec(BASE)
      const other = await w.tok('sup2')
      const id = run.pre.body.importId
      expectRes(await get(`/recovery-imports/receivables/${id}/report`, other), 404, 'import.preview_not_found')
      expectRes(await get(`/recovery-imports/receivables/${id}/report/items?category=new`, other), 404, 'import.preview_not_found')
    })

    it('[rule-recouvrement-import-green-light] another supervisor confirming a preview gets the same 404 import.preview_not_found as for an unknown id and nothing is created; the creator can still confirm', async () => {
      const run = await previewRec(BASE)
      const other = await w.tok('sup2')
      const id = run.pre.body.importId
      const foreign = await post(`/recovery-imports/receivables/${id}/confirm`, other)
      const unknown = await post(`/recovery-imports/receivables/${UNKNOWN_UUID}/confirm`, other)
      expectRes(foreign, 404, 'import.preview_not_found')
      expect(foreign.body).toEqual(unknown.body)
      expect(await sql('select 1 from base.cases')).toHaveLength(0)
      expectRes(await post(`/recovery-imports/receivables/${id}/confirm`, sup), 200)
    })

    it('[rule-recouvrement-import-green-light] no business data is written by a preview whatever the type; a malformed or unknown preview id answers 404 or 400', async () => {
      await previewRec(BASE)
      expect(await sql('select 1 from base.invoices')).toHaveLength(0)
      expectRes(await get(`/recovery-imports/receivables/${UNKNOWN_UUID}/errors`, sup), 404, 'import.preview_not_found')
      expectRes(await get('/recovery-imports/receivables/pas-un-uuid/errors', sup), 400, 'api.validation.incoming_failed')
      expectRes(await post(`/recovery-imports/receivables/${UNKNOWN_UUID}/confirm`, sup), 404, 'import.preview_not_found')
    })

    it('[rule-recouvrement-import-pivot-format] the file mechanism of the foundation applies: a PDF renamed .csv, a header-only file and a file without the expected columns are refused with the codes of the foundation', async () => {
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n', 'utf8')
      expectRes((await runImport(sup, 'receivables', pdf, { controlTotal: '1.00', confirm: false, fileName: 'x.csv' })).pre, 400, 'import.invalid_file_type')
      expectRes((await runImport(sup, 'receivables', strip([RECEIVABLES_HEADER]), { controlTotal: '0.00', confirm: false })).pre, 400, 'import.empty_file')
      expectRes((await runImport(sup, 'receivables', strip([['numero'], ['FA-1']]), { controlTotal: '0.00', confirm: false })).pre, 400, 'import.missing_columns')
      const form = await upload(sup, Buffer.from('a'), 'x.txt', { path: '/recovery-imports/receivables/preview?controlTotal=0' })
      expectRes(form, 400, 'import.invalid_file_type')
    })

    it('[rule-recouvrement-import-pivot-format] the import types appear in the preview table of the foundation (one memory of confirmed files per type)', async () => {
      await runImport(sup, 'receivables', receivablesFile(BASE, D(-3)), { controlTotal: '1000.00' })
      const rows = await sql("select feature, status from base.import_previews where status = 'confirmed'")
      expect(rows).toHaveLength(1)
      expect(String(rows[0].feature)).toMatch(/receivables/)
    })

    it('[rule-recouvrement-import-audited] the confirmation is traced once per import with the object type of the file and a summary without any cell, customer id, invoice number or coordinate; the preview is not traced', async () => {
      const admin = await w.tok('admin')
      const rows: Inv[] = [BASE[0], { numero: 'FA-002', debiteur: 'D2', montant: 5000 }]
      const run = await runImport(sup, 'receivables', receivablesFile(rows, D(-3)), { controlTotal: euros(receivablesTotal(rows)), confirm: false })
      expect((await get('/audit-logs?action=recovery-imports:confirm', admin)).body.total).toBe(0)
      await post(`/recovery-imports/receivables/${run.pre.body.importId}/confirm`, sup)
      const log = await get('/audit-logs?action=recovery-imports:confirm', admin)
      expect(log.body.total).toBe(1)
      const e = log.body.entries[0]
      expect(e.objectType).toBe('Import de créances')
      expect(e.objectId).toBe(run.pre.body.importId)
      expect(e.actor.email).toBe('sup@recette.test')
      expect(e.summary).toMatch(/^Import de créances confirmé/)
      expect(e.summary).not.toMatch(/D1|D2|FA-00|552100554|example/)
    })

    it('[rule-recouvrement-import-audited] the object types of the five imports are « Import de créances », « de paiements », « de litiges », « d\'interlocuteurs » and « de pièces »', async () => {
      const admin = await w.tok('admin')
      await importReceivables(sup, BASE, D(-3))
      await importPayments(sup, [{ reference: 'P-1', montant: 100, date: D(-9) }])
      await importOk(sup, 'contacts', contactsFile([defaultContact('D1')]))
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-001', '', 'Facture contestée', 'Service X', D(-1)]]))
      await importOk(sup, 'documents', strip([DOCUMENTS_HEADER, ['FA-001', '', 'contrat', 'C-1']]))
      const log = await get('/audit-logs?action=recovery-imports:confirm&size=100', admin)
      expect(log.body.entries.map((e: any) => e.objectType).sort()).toEqual(
        ['Import de créances', 'Import de paiements', 'Import de litiges', "Import d'interlocuteurs", 'Import de pièces'].sort(),
      )
    })

    it('[rule-recouvrement-money-cents] a snapshot of 2 000 rows is read and confirmed with exact totals', async () => {
      const rows: Inv[] = Array.from({ length: 2000 }, (_, i) => ({ numero: `FA-${String(i).padStart(5, '0')}`, debiteur: `D${i % 400}`, montant: 1000 + i, late: 10 + (i % 50) }))
      const run = await runImport(sup, 'receivables', receivablesFile(rows, D(-3)), { controlTotal: euros(receivablesTotal(rows)) })
      expectRes(run.conf!, 200)
      expect(run.pre.body).toMatchObject({ totalRows: 2000, validRows: 2000, computedTotalCents: receivablesTotal(rows) })
      expect(ok(await get('/cases?size=1', sup)).total).toBe(400)
    })
  })

  describe('Créances : changement de segment (arbitrage)', () => {
    // Le test « changement de segment » (offres débloquées révoquées) passe par les outils des agents : il est dans acceptance-v1-agents.test.ts (lot des outils des agents).
    it('[rule-recouvrement-debtor-attribute-change][D-0014] a following snapshot that changes the nature of a debtor is accepted as well', async () => {
      await setupWorld({ policy: false, statement: false, contacts: false }, w)
      const rows: Inv[] = [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, nature: 'entreprise' }]
      const run = await runImport(sup, 'receivables', receivablesFile(rows, D(-2)), { controlTotal: '1000.00' })
      expectRes(run.conf!, 200)
      expect(await w.caseDetail('D1')).toMatchObject({ nature: 'company', debtorSiren: '443061841' })
    })
  })

  describe('Paiements', () => {
    it('[rule-recouvrement-payments-columns] a valid statement gives an accepted preview and is confirmed with its effects', async () => {
      const file = paymentsFile([{ reference: 'P-1', montant: 1000, date: D(-4) }, { reference: 'P-2', montant: 2550, date: D(-3) }], D(-1))
      const run = await runImport(sup, 'payments', file)
      expectRes(run.pre, 200)
      expect(run.pre.body).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0, accepted: true })
      expectRes(run.conf!, 200)
      expect(run.conf!.body).toMatchObject({ skippedCount: 0 })
      expect(Array.isArray(run.conf!.body.effects)).toBe(true)
    })

    const REFUSED_PAYMENTS: [string, string, string[][]][] = [
      ['a reference repeated in the file', 'reference', [['P-1', '10.00', D(-2), D(-1)], ['P-1', '20.00', D(-2), D(-1)]]],
      ['an empty reference', 'reference', [['', '10.00', D(-2), D(-1)]]],
      ['a reference of 101 characters', 'reference', [['R'.repeat(101), '10.00', D(-2), D(-1)]]],
      ['a zero amount', 'montant', [['P-1', '0', D(-2), D(-1)]]],
      ['a negative amount', 'montant', [['P-1', '-5.00', D(-2), D(-1)]]],
      ['an amount above 10 000 000 000 cents', 'montant', [['P-1', '100000000.01', D(-2), D(-1)]]],
      ['an amount with three decimals', 'montant', [['P-1', '1.005', D(-2), D(-1)]]],
      ['an unreadable payment date', 'date_paiement', [['P-1', '10.00', 'hier', D(-1)]]],
      ['a payment date in the future', 'date_paiement', [['P-1', '10.00', D(1), D(-1)]]],
      ['a statement date in the future', 'date_releve', [['P-1', '10.00', D(-2), D(1)]]],
      ['different statement dates on two rows', 'date_releve', [['P-1', '10.00', D(-2), D(-1)], ['P-2', '10.00', D(-2), D(-2)]]],
    ]
    for (const [name, column, rows] of REFUSED_PAYMENTS) {
      it(`[rule-recouvrement-import-refuse-whole][rule-recouvrement-payments-columns] ${name}: the whole file is refused at the first error (column ${column}), confirmation 409 imports.file_refused`, async () => {
        const run = await runImport(sup, 'payments', strip([PAYMENTS_HEADER, ...rows]), { confirm: false })
        expectRes(run.pre, 200)
        expect(run.pre.body).toMatchObject({ accepted: false, errorRows: 1 })
        const errors = errorEntries((await get(`/recovery-imports/payments/${run.pre.body.importId}/errors`, sup)).body)
        expect(errors).toHaveLength(1)
        expect(errors[0].column).toBe(column)
        expectRes(await post(`/recovery-imports/payments/${run.pre.body.importId}/confirm`, sup), 409, 'imports.file_refused')
        expect(await sql('select 1 from base.payments')).toHaveLength(0)
      })
    }

    it('[rule-recouvrement-statement-fresh] a statement older than today minus the maximum age of the active policy is refused as a whole: row 1, column date_releve, « Relevé trop ancien »', async () => {
      await setupWorld({ statement: false, contacts: false }, w)
      const run = await runImport(sup, 'payments', paymentsFile([{ reference: 'P-1', montant: 100, date: D(-40) }], D(-31)), { confirm: false })
      expectRes(run.pre, 200)
      expect(run.pre.body.accepted).toBe(false)
      const errors = errorEntries((await get(`/recovery-imports/payments/${run.pre.body.importId}/errors`, sup)).body)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ row: 1, column: 'date_releve' })
      expect(errors[0].reason).toMatch(/^Relevé trop ancien/)
      expectRes(await post(`/recovery-imports/payments/${run.pre.body.importId}/confirm`, sup), 409, 'imports.file_refused')
    })

    it('[rule-recouvrement-statement-fresh] a statement exactly as old as the maximum age is accepted', async () => {
      await setupWorld({ statement: false, contacts: false }, w)
      const run = await runImport(sup, 'payments', paymentsFile([{ reference: 'P-1', montant: 100, date: D(-40) }], D(-30)), { confirm: false })
      expect(run.pre.body.accepted).toBe(true)
    })

    it('[rule-recouvrement-statement-fresh] without an active policy the freshness control is skipped (an old statement is accepted) and the status stays not fresh', async () => {
      await setupWorld({ policy: false, statement: false, contacts: false }, w)
      const run = await runImport(sup, 'payments', paymentsFile([{ reference: 'P-1', montant: 100, date: D(-400) }], D(-399)))
      expectRes(run.conf!, 200)
      const status = ok(await get('/recovery-imports/status', sup))
      expect(status.statement).toMatchObject({ lastStatementDate: D(-399), maxAgeDays: null, fresh: false })
    })

    it('[rule-recouvrement-payments-columns] a reference already confirmed in a previous statement is ignored at the confirmation and counted in skippedCount', async () => {
      await importPayments(sup, [{ reference: 'P-1', montant: 100, date: D(-9) }], D(-2))
      const run = await runImport(sup, 'payments', paymentsFile([{ reference: 'P-1', montant: 100, date: D(-9) }, { reference: 'P-2', montant: 200, date: D(-8) }], D(-1)))
      expectRes(run.conf!, 200)
      expect(run.conf!.body.skippedCount).toBe(1)
      expect(await sql('select count(*)::int as n from base.payments')).toEqual([{ n: 2 }])
    })

    it('[rule-recouvrement-import-report] the report of a statement is compared with the previous statement by reference', async () => {
      const first = await runImport(sup, 'payments', paymentsFile([{ reference: 'P-1', montant: 100, date: D(-9) }], D(-2)))
      const second = await runImport(sup, 'payments', paymentsFile([{ reference: 'P-1', montant: 100, date: D(-9) }, { reference: 'P-2', montant: 200, date: D(-8) }], D(-1)), { confirm: false })
      const report = ok(await get(`/recovery-imports/payments/${second.pre.body.importId}/report`, sup))
      expect(report.previous.importId).toBe(first.pre.body.importId)
      expect(report.categories.find((c: any) => c.code === 'new').rows).toBe(1)
    })
  })

  describe('statut et historique', () => {
    it('[rule-recouvrement-statement-fresh] the status of a platform without import: no statement, not fresh, no extraction date, nothing confirmed', async () => {
      expect(ok(await get('/recovery-imports/status', sup))).toEqual({
        statement: { lastStatementDate: null, maxAgeDays: null, fresh: false },
        receivablesExtractionDate: null,
        lastConfirmed: [],
      })
    })

    it('[rule-recouvrement-statement-fresh] with an active policy and a statement of the day the status is fresh, with the maximum age of the policy; the last confirmed import of each type is listed', async () => {
      await setupWorld({}, w)
      const status = ok(await get('/recovery-imports/status', sup))
      expect(status.statement).toEqual({ lastStatementDate: today(), maxAgeDays: 30, fresh: true })
      expect(status.receivablesExtractionDate).toBe(D(-3))
      expect(status.lastConfirmed.map((l: any) => l.type).sort()).toEqual(['contacts', 'payments', 'receivables'])
      for (const l of status.lastConfirmed) {
        expect(l.confirmedAt).toBeTruthy()
        expect(l.fileName).toBeTruthy()
      }
    })

    it('[rule-recouvrement-statement-fresh] a statement dated 31 days ago, confirmed before the policy was active, makes the status not fresh once the policy (30 days) is active', async () => {
      await setupWorld({ policy: false, statement: false, contacts: false }, w)
      await importPayments(sup, [{ reference: 'P-1', montant: 100, date: D(-40) }], D(-31))
      await activatePolicy(sup, policyDoc())
      expect(ok(await get('/recovery-imports/status', sup)).statement).toEqual({ lastStatementDate: D(-31), maxAgeDays: 30, fresh: false })
    })

    it('[rule-recouvrement-import-pivot-format] the history lists the confirmed imports, newest first, with the author and the counts, and filters by type', async () => {
      await importReceivables(sup, BASE, D(-3))
      await importPayments(sup, [{ reference: 'P-1', montant: 100, date: D(-9) }], D(-1))
      const all = ok(await get('/recovery-imports/history', sup))
      expect(all.total).toBe(2)
      expect(all.items.map((i: any) => i.type)).toEqual(['payments', 'receivables'])
      expect(all.items[0]).toMatchObject({ fileName: 'payments.csv', totalRows: 1, confirmedBy: { email: 'sup@recette.test' } })
      expect(Object.keys(all.items[0]).sort()).toEqual(['confirmedAt', 'confirmedBy', 'createdCount', 'fileName', 'importId', 'skippedCount', 'totalRows', 'type'])
      expect(ok(await get('/recovery-imports/history?type=receivables', sup)).items.map((i: any) => i.type)).toEqual(['receivables'])
      expect(ok(await get('/recovery-imports/history?from=1&size=1', sup)).items).toHaveLength(1)
      expectRes(await get('/recovery-imports/history?type=inconnu', sup), 400, 'api.validation.incoming_failed')
      expectRes(await get('/recovery-imports/history?size=0', sup), 400, 'api.validation.incoming_failed')
    })
  })

  describe('lettrage des paiements', () => {
    const PORTFOLIO: Inv[] = [
      { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
      { numero: 'FA-002', debiteur: 'D1', montant: 50000 },
      { numero: 'FA-003', debiteur: 'D2', montant: 30000 },
      { numero: 'AV-001', debiteur: 'D5', montant: -5000, type: 'avoir' },
    ]
    const balances = async (debtor: string) =>
      Object.fromEntries((await w.caseDetail(debtor)).invoices.map((i: any) => [i.number, i.balanceCents]))

    beforeEach(async () => {
      await setupWorld({ invoices: PORTFOLIO }, w)
    })

    it('[rule-recouvrement-lettrage-after-extraction] a payment dated on or before the extraction date of the snapshot is already in the balances and changes nothing', async () => {
      await w.payments([{ reference: 'VIR FA-001', montant: 40000, date: w.extraction }], D(-1))
      expect(await balances('D1')).toMatchObject({ 'FA-001': 100000 })
      expect((await w.queueCounts()).byType.unassigned_payment).toBe(0)
    })

    it('[rule-recouvrement-lettrage-after-extraction][rule-recouvrement-lettrage-order] a payment strictly after the extraction date whose reference contains the number of one open invoice (whole word, any case) is applied to it', async () => {
      await w.payments([{ reference: 'vir fa-001 octobre', montant: 40000, date: addDays(w.extraction, 1) }])
      expect(await balances('D1')).toMatchObject({ 'FA-001': 60000, 'FA-002': 50000 })
      expect((await w.caseDetail('D1')).negotiableCents).toBe(110000)
    })

    it('[rule-recouvrement-lettrage-order] the reference must contain the number as a whole word: FA-001X does not match; the payment then follows the amount rule or stays unassigned', async () => {
      await w.payments([{ reference: 'VIR FA-001X', montant: 12345, date: addDays(w.extraction, 1) }])
      expect(await balances('D1')).toMatchObject({ 'FA-001': 100000 })
      expect((await w.queueCounts()).byType.unassigned_payment).toBe(1)
    })

    it('[rule-recouvrement-lettrage-order] without a number in the reference, an amount equal to the balance of exactly one open invoice applies to it', async () => {
      await w.payments([{ reference: 'VIREMENT SANS NUMERO', montant: 30000, date: addDays(w.extraction, 1) }])
      expect(await balances('D2')).toMatchObject({ 'FA-003': 0 })
      expect((await w.caseDetail('D2')).state).toBe('settled')
    })

    it('[rule-recouvrement-lettrage-order] a reference with the numbers of two invoices does not match the first rule; the amount rule then decides', async () => {
      await w.payments([{ reference: 'FA-001 FA-002', montant: 50000, date: addDays(w.extraction, 1) }])
      expect(await balances('D1')).toMatchObject({ 'FA-001': 100000, 'FA-002': 0 })
    })

    it('[rule-recouvrement-lettrage-order] credit notes receive no payment: a reference with a credit note number leaves the payment unassigned', async () => {
      await w.payments([{ reference: 'REMBOURSEMENT AV-001', montant: 4321, date: addDays(w.extraction, 1) }])
      expect(await balances('D5')).toMatchObject({ 'AV-001': -5000 })
      expect((await w.queueCounts()).byType.unassigned_payment).toBe(1)
    })

    it('[rule-recouvrement-lettrage-excess][rule-recouvrement-unassigned-payment-freeze] an excess over the balance of the invoice found by its number settles the invoice and becomes an unassigned payment in the queue', async () => {
      await w.payments([{ reference: 'FA-003', montant: 35000, date: addDays(w.extraction, 1) }])
      expect(await balances('D2')).toMatchObject({ 'FA-003': 0 })
      const items = await w.queueItems('&type=unassigned_payment')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ type: 'unassigned_payment', status: 'open' })
      expect(items[0].summary.length).toBeGreaterThan(0)
    })

    it('[rule-recouvrement-unassigned-payment-freeze][rule-recouvrement-queue-unassigned-until-assigned] an unassigned payment whose amount equals the total balance of a case freezes the case and offers its invoices as candidates', async () => {
      await w.payments([{ reference: 'VIREMENT MYSTERE', montant: 150000, date: addDays(w.extraction, 1) }])
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('frozen')
      expect(detail.freezes).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unassigned_payment', scope: 'case' })]))
      const items = await w.queueItems('&type=unassigned_payment')
      expect(items).toHaveLength(1)
      expect(items[0].candidates.map((c: any) => c.number).sort()).toEqual(['FA-001', 'FA-002'])
      expect(items[0].allowedDecisions).toEqual(['assign'])
      expect((await w.caseDetail('D2')).state).toBe('open')
    })

    it('[rule-recouvrement-unassigned-payment-freeze] an amount that equals the balance of open invoices of two cases freezes both cases', async () => {
      await importReceivables(sup, [...PORTFOLIO, { numero: 'FA-004', debiteur: 'D3', montant: 30000 }], D(-2))
      await w.payments([{ reference: 'VIREMENT AMBIGU', montant: 30000, date: D(-1) }])
      expect((await w.caseDetail('D2')).state).toBe('frozen')
      expect((await w.caseDetail('D3')).state).toBe('frozen')
      expect((await w.caseDetail('D2')).freezes[0]).toMatchObject({ code: 'unassigned_payment' })
    })

    it('[rule-recouvrement-payment-on-frozen-invoice] a payment is applied to a frozen invoice too: the freeze stops the negotiation, not the bookkeeping of the balance', async () => {
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-001', '', 'Facture contestée', 'Service X', D(-1)]]))
      expect((await w.caseDetail('D1')).invoices.find((i: any) => i.number === 'FA-001').frozen).toBe(true)
      await w.payments([{ reference: 'FA-001', montant: 25000, date: addDays(w.extraction, 1) }])
      expect(await balances('D1')).toMatchObject({ 'FA-001': 75000 })
    })

    it('[rule-recouvrement-lettrage-after-extraction][rule-recouvrement-receivables-snapshot] a payment already applied is not applied twice when the next snapshot reflects it', async () => {
      await w.payments([{ reference: 'FA-001', montant: 40000, date: D(-1) }])
      expect(await balances('D1')).toMatchObject({ 'FA-001': 60000 })
      await importReceivables(sup, [{ ...PORTFOLIO[0], solde: 60000 }, PORTFOLIO[1], PORTFOLIO[2], PORTFOLIO[3]], D(0))
      expect(await balances('D1')).toMatchObject({ 'FA-001': 60000 })
    })

    it('[rule-recouvrement-unassigned-payment-freeze][rule-recouvrement-queue-auto-close] a following snapshot that includes the payment in the balances closes the unassigned payment item without decision and lifts the freeze', async () => {
      await w.payments([{ reference: 'VIREMENT MYSTERE', montant: 150000, date: D(-1) }])
      expect((await w.caseDetail('D1')).state).toBe('frozen')
      await importReceivables(sup, [{ ...PORTFOLIO[0], solde: 0 }, { ...PORTFOLIO[1], solde: 0 }, PORTFOLIO[2], PORTFOLIO[3]], D(0))
      const decided = await w.queueItems('&status=decided&type=unassigned_payment')
      expect(decided).toHaveLength(1)
      expect(decided[0].decision).toMatchObject({ code: 'auto_closed', decidedBy: null })
      expect((await w.queueCounts()).byType.unassigned_payment).toBe(0)
    })
  })

  describe('Litiges', () => {
    beforeEach(async () => {
      await setupWorld({
        invoices: [
          { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
          { numero: 'FA-002', debiteur: 'D1', montant: 50000 },
          { numero: 'FA-DUP', debiteur: 'D2', montant: 1000, entite: SIREN_A },
          { numero: 'FA-DUP', debiteur: 'D3', montant: 2000, entite: SIREN_B },
        ],
      }, w)
    })
    const file = (rows: string[][]) => strip([DISPUTES_HEADER, ...rows])

    it('[rule-recouvrement-disputes-import-freeze] each valid row opens a dispute of origin import and freezes the invoice, out of the negotiable amount', async () => {
      const run = await runImport(sup, 'disputes', file([['FA-001', '', 'Marchandise non reçue', 'Service clients', D(-2)]]))
      expectRes(run.pre, 200)
      expect(run.pre.body).toMatchObject({ validRows: 1, errorRows: 0 })
      expectRes(run.conf!, 200)
      expect(run.conf!.body.createdCount).toBe(1)
      const detail = await w.caseDetail('D1')
      expect(detail.invoices.find((i: any) => i.number === 'FA-001')).toMatchObject({ frozen: true, negotiable: false, freezeCodes: ['dispute'] })
      expect(detail.negotiableCents).toBe(50000)
      expect(detail.freezes).toEqual([expect.objectContaining({ code: 'dispute', scope: 'invoice', invoiceNumber: 'FA-001', reference: 'Marchandise non reçue' })])
      expect(detail.state).toBe('open')
      const lit = await w.tok('lit')
      const disputes = ok(await get('/disputes', lit))
      expect(disputes.total).toBe(1)
      expect(disputes.items[0]).toMatchObject({ origin: 'import', status: 'open', invoiceNumber: 'FA-001', owner: 'Service clients', reason: 'Marchandise non reçue' })
    })

    it('[rule-recouvrement-disputes-import-freeze] when every open invoice of a case is frozen the case is frozen (transition dispute_opened or all_invoices_frozen)', async () => {
      await importOk(sup, 'disputes', file([['FA-001', '', 'a', 'b', D(-2)], ['FA-002', '', 'a', 'b', D(-2)]]))
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('frozen')
      const history = ok(await get(`/cases/${detail.id}/state-history`, sup)).items
      expect(['dispute_opened', 'all_invoices_frozen']).toContain(history[0].cause)
      expect(history[0]).toMatchObject({ from: 'open', to: 'frozen' })
    })

    const ROW_ERRORS: [string, string[], string | string[]][] = [
      ['an unknown invoice', ['FA-INCONNUE', '', 'motif', 'resp', D(-2)], 'numero'],
      ['an invoice number found at two creditor entities without SIREN', ['FA-DUP', '', 'motif', 'resp', D(-2)], ['numero', 'entite_siren']],
      ['a creditor SIREN of 8 digits', ['FA-001', '12345678', 'motif', 'resp', D(-2)], 'entite_siren'],
      ['an empty reason', ['FA-001', '', '', 'resp', D(-2)], 'motif'],
      ['a reason of 501 characters', ['FA-001', '', 'm'.repeat(501), 'resp', D(-2)], 'motif'],
      ['an empty owner', ['FA-001', '', 'motif', '', D(-2)], 'responsable'],
      ['an owner of 101 characters', ['FA-001', '', 'motif', 'r'.repeat(101), D(-2)], 'responsable'],
      ['an opening date in the future', ['FA-001', '', 'motif', 'resp', D(1)], 'date_ouverture'],
      ['an unreadable opening date', ['FA-001', '', 'motif', 'resp', 'bientôt'], 'date_ouverture'],
    ]
    for (const [name, row, column] of ROW_ERRORS) {
      it(`[rule-recouvrement-disputes-import-freeze] ${name}: a row error on column ${column}, the other rows are still imported`, async () => {
        const run = await runImport(sup, 'disputes', file([row, ['FA-002', '', 'Valide', 'Service', D(-2)]]))
        expectRes(run.pre, 200)
        expect(run.pre.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
        const errors = errorEntries((await get(`/recovery-imports/disputes/${run.pre.body.importId}/errors`, sup)).body)
        expect(errors).toHaveLength(1)
        expect(errors[0].row).toBe(2)
        expect(Array.isArray(column) ? column : [column]).toContain(errors[0].column)
        expectRes(run.conf!, 200)
        expect(run.conf!.body.createdCount).toBe(1)
        expect((await w.caseDetail('D1')).invoices.find((i: any) => i.number === 'FA-001').frozen).toBe(false)
        expect((await w.caseDetail('D1')).invoices.find((i: any) => i.number === 'FA-002').frozen).toBe(true)
      })
    }

    it('[rule-recouvrement-disputes-import-freeze] an invoice number shared by two creditor entities is resolved by the creditor SIREN', async () => {
      const run = await runImport(sup, 'disputes', file([['FA-DUP', SIREN_B, 'motif', 'resp', D(-2)]]))
      expect(run.pre.body).toMatchObject({ validRows: 1, errorRows: 0 })
      expectRes(run.conf!, 200)
      expect((await w.caseDetail('D3')).invoices[0].frozen).toBe(true)
      expect((await w.caseDetail('D2')).invoices[0].frozen).toBe(false)
    })

    it('[rule-recouvrement-disputes-import-additive] an invoice already in an open dispute is counted in skippedCount; the file never closes a dispute', async () => {
      await importOk(sup, 'disputes', file([['FA-001', '', 'Premier motif', 'Resp', D(-3)]]))
      const run = await runImport(sup, 'disputes', file([['FA-001', '', 'Second motif', 'Resp', D(-2)], ['FA-002', '', 'Autre', 'Resp', D(-2)]]))
      expectRes(run.conf!, 200)
      expect(run.conf!.body).toMatchObject({ createdCount: 1, skippedCount: 1 })
      const lit = await w.tok('lit')
      const open = ok(await get('/disputes?size=100', lit))
      expect(open.total).toBe(2)
      expect(open.items.find((d: any) => d.invoiceNumber === 'FA-001').reason).toBe('Premier motif')
      await importOk(sup, 'disputes', file([['FA-DUP', SIREN_A, 'Troisième', 'Resp', D(-1)]]))
      expect(ok(await get('/disputes?status=open&size=100', lit)).total).toBe(3)
    })

    it('[rule-recouvrement-import-report] the report of a disputes file lists new lines by natural key (entity and number)', async () => {
      const run = await runImport(sup, 'disputes', file([['FA-001', '', 'm', 'r', D(-2)]]), { confirm: false })
      const report = ok(await get(`/recovery-imports/disputes/${run.pre.body.importId}/report`, sup))
      expect(report).toMatchObject({ type: 'disputes', previous: null })
      expect(report.categories.find((c: any) => c.code === 'new').rows).toBe(1)
    })
  })

  describe('Interlocuteurs', () => {
    beforeEach(async () => {
      await setupWorld({
        invoices: [
          { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
          { numero: 'FA-002', debiteur: 'DC', montant: 50000, nature: 'entreprise' },
        ],
        contacts: false,
      }, w)
    })
    const file = (rows: string[][]) => strip([CONTACTS_HEADER, ...rows])

    it('[rule-recouvrement-contacts-columns] valid contacts are imported: a payer for a family, accounts-payable, buyer and approver for a company', async () => {
      const run = await runImport(sup, 'contacts', file([
        ['D1', 'payeur', 'a@example.test', '+33612345678', '1 rue A 75001 Paris'],
        ['DC', 'comptabilite_fournisseurs', 'c@example.test', '', ''],
        ['DC', 'acheteur', '', '0145678901', ''],
        ['DC', 'valideur', '', '', '3 rue C 69001 Lyon'],
      ]))
      expect(run.pre.body).toMatchObject({ validRows: 4, errorRows: 0 })
      expectRes(run.conf!, 200)
      expect(run.conf!.body.createdCount).toBe(4)
      expect(await sql('select count(*)::int as n from base.contacts')).toEqual([{ n: 4 }])
    })

    const ROW_ERRORS: [string, string[], string[]][] = [
      ['an unknown debtor', ['INCONNU', 'payeur', 'a@example.test', '', ''], ['debiteur_id']],
      ['a role that does not fit a family', ['D1', 'acheteur', 'a@example.test', '', ''], ['role']],
      ['a role that does not fit a company', ['DC', 'payeur', 'a@example.test', '', ''], ['role']],
      ['an unknown role', ['D1', 'directeur', 'a@example.test', '', ''], ['role']],
      ['no coordinate at all', ['D1', 'payeur', '', '', ''], ['courriel', 'telephone', 'adresse_postale']],
    ]
    for (const [name, row, columns] of ROW_ERRORS) {
      it(`[rule-recouvrement-contacts-columns] ${name}: a row error (the other rows are imported)`, async () => {
        const run = await runImport(sup, 'contacts', file([row, ['DC', 'acheteur', 'ok@example.test', '', '']]))
        expectRes(run.pre, 200)
        expect(run.pre.body).toMatchObject({ validRows: 1, errorRows: 1 })
        const errors = errorEntries((await get(`/recovery-imports/contacts/${run.pre.body.importId}/errors`, sup)).body)
        expect(errors.length).toBeGreaterThanOrEqual(1)
        expect(errors[0].row).toBe(2)
        expect(columns).toContain(errors[0].column)
        expectRes(run.conf!, 200)
        expect(run.conf!.body.createdCount).toBe(1)
      })
    }

    it('[rule-recouvrement-contact-invalid-suspends-channel] an invalid e-mail is not a row error: it suspends the e-mail and SMS channel of this contact; the report counts the suspended contacts', async () => {
      const run = await runImport(sup, 'contacts', file([['D1', 'payeur', 'pas-un-courriel', '', '1 rue A 75001 Paris']]))
      expect(run.pre.body).toMatchObject({ validRows: 1, errorRows: 0 })
      const report = ok(await get(`/recovery-imports/contacts/${run.pre.body.importId}/report`, sup))
      expect(report.notes).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'suspended_channels', count: 1 })]))
    })

    it('[rule-recouvrement-contact-invalid-suspends-channel] a contact with an empty coordinate is not suspended on that account: an empty value only makes the channel unavailable', async () => {
      const run = await runImport(sup, 'contacts', file([['D1', 'payeur', '', '+33612345678', '']]), { confirm: false })
      const report = ok(await get(`/recovery-imports/contacts/${run.pre.body.importId}/report`, sup))
      expect(report.notes.find((n: any) => n.code === 'suspended_channels')?.count ?? 0).toBe(0)
    })

    it('[rule-recouvrement-contacts-columns] the confirmation replaces the whole set of contacts and keeps the identifier of those whose debtor, role and coordinates are unchanged', async () => {
      await importOk(sup, 'contacts', file([['D1', 'payeur', 'a@example.test', '+33612345678', ''], ['DC', 'acheteur', 'x@example.test', '', '']]))
      const kept = (await sql<{ id: string }>("select c.id from base.contacts c join base.cases k on k.id = c.case_id where k.debtor_id = 'D1'"))[0].id
      await importOk(sup, 'contacts', file([['D1', 'payeur', 'a@example.test', '+33612345678', ''], ['D1', 'payeur', 'autre@example.test', '', '']]))
      const rows = await sql<{ id: string; email: string; debtor: string }>(
        'select c.id, c.email, k.debtor_id as debtor from base.contacts c join base.cases k on k.id = c.case_id order by c.email',
      )
      expect(rows.map((r) => r.debtor)).toEqual(['D1', 'D1'])
      expect(rows.find((r) => r.email === 'a@example.test')!.id).toBe(kept)
    })

    it('[rule-recouvrement-contacts-columns] a row repeated identically in the file is a duplicate: ignored and counted in skippedCount, not an error', async () => {
      const run = await runImport(sup, 'contacts', file([['D1', 'payeur', 'a@example.test', '', ''], ['D1', 'payeur', 'a@example.test', '', '']]))
      expect(run.pre.body.errorRows).toBe(0)
      expectRes(run.conf!, 200)
      expect(run.conf!.body).toMatchObject({ createdCount: 1, skippedCount: 1 })
    })
  })

  describe('Pièces', () => {
    beforeEach(async () => {
      await setupWorld({
        invoices: [
          { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
          { numero: 'FA-DUP', debiteur: 'D2', montant: 1000, entite: SIREN_A },
          { numero: 'FA-DUP', debiteur: 'D3', montant: 2000, entite: SIREN_B },
        ],
      }, w)
    })
    const file = (rows: string[][]) => strip([DOCUMENTS_HEADER, ...rows])

    it('[rule-recouvrement-documents-columns] valid rows are imported; the whole index is replaced by the next file', async () => {
      await importOk(sup, 'documents', file([['FA-001', '', 'contrat', 'C-1'], ['FA-001', '', 'commande', '']]))
      expect(await sql('select count(*)::int as n from base.invoice_documents')).toEqual([{ n: 2 }])
      await importOk(sup, 'documents', file([['FA-001', '', 'preuve_livraison', 'P-9']]))
      expect(await sql('select count(*)::int as n from base.invoice_documents')).toEqual([{ n: 1 }])
    })

    const ROW_ERRORS: [string, string[], string][] = [
      ['an unknown invoice', ['FA-NULLE', '', 'contrat', ''], 'numero'],
      ['an invoice number shared by two entities without SIREN', ['FA-DUP', '', 'contrat', ''], 'numero'],
      ['an unknown document type', ['FA-001', '', 'passeport', ''], 'type'],
      ['a reference of 101 characters', ['FA-001', '', 'contrat', 'r'.repeat(101)], 'reference'],
    ]
    for (const [name, row, column] of ROW_ERRORS) {
      it(`[rule-recouvrement-documents-columns] ${name}: a row error on column ${column}`, async () => {
        const run = await runImport(sup, 'documents', file([row, ['FA-001', '', 'commande', '']]))
        expect(run.pre.body).toMatchObject({ validRows: 1, errorRows: 1 })
        const errors = errorEntries((await get(`/recovery-imports/documents/${run.pre.body.importId}/errors`, sup)).body)
        expect(errors[0]).toMatchObject({ row: 2, column })
      })
    }

    it('[rule-recouvrement-documents-columns] a repeated (invoice, type) is a duplicate: ignored and counted in skippedCount', async () => {
      const run = await runImport(sup, 'documents', file([['FA-001', '', 'contrat', 'C-1'], ['FA-001', '', 'contrat', 'C-2']]))
      expect(run.pre.body.errorRows).toBe(0)
      expectRes(run.conf!, 200)
      expect(run.conf!.body).toMatchObject({ createdCount: 1, skippedCount: 1 })
    })

    it('[rule-recouvrement-documents-columns] the creditor SIREN resolves an invoice number shared by two entities', async () => {
      const run = await runImport(sup, 'documents', file([['FA-DUP', SIREN_B, 'contrat', '']]))
      expect(run.pre.body).toMatchObject({ validRows: 1, errorRows: 0 })
    })
  })
})
