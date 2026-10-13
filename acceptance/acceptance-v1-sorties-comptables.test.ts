import { resetData, closePool, sql } from './harness'
import {
  World, get, post, http, expectRes, ok, UNKNOWN_UUID, setupWorld, daysFromToday, importOk, receivablesFile, receivablesTotal, euros, runImport, SIREN_A, SIREN_B,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'
import { API_URL } from './harness'

// Version v1-cerveau-recouvrement : sorties comptables (liste, approbation par lot, export, passage en perte, constat, écart).

const D = (n: number) => daysFromToday(n)
const OUTPUT_KEYS = ['amountCents', 'approvedAt', 'approvedBy', 'caseId', 'commitmentId', 'createdAt', 'creditorSiren', 'debtorId', 'id', 'importsSinceApproval', 'lines', 'maxImports', 'origin', 'reason', 'recognizedAt', 'reference', 'status', 'type']

describe('Recouvrement - sorties comptables', () => {
  let w: World
  let sup: string
  let extractionDay = -3

  beforeEach(async () => {
    await resetData()
    w = new World()
    extractionDay = -3
  })
  afterAll(async () => {
    await closePool()
  })

  const BASE: Inv[] = [
    { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
    { numero: 'FB-001', debiteur: 'D2', montant: 50000, entite: SIREN_B },
    { numero: 'FA-003', debiteur: 'D3', montant: 80000 },
  ]
  async function world(invoices: Inv[] = BASE, global: any = {}) {
    await setupWorld({ invoices, policy: { global } }, w)
    sup = await w.tok('sup')
  }
  const writeOff = async (debtor: string, number: string, amountCents: number, reason = 'Créance irrécouvrable') =>
    post('/ledger-outputs/write-offs', sup, { caseId: await w.caseId(debtor), lines: [{ invoiceId: await w.invoiceId(number), amountCents }], reason })
  const wo = async (debtor: string, number: string, amountCents: number) => ok(await writeOff(debtor, number, amountCents)).output
  const approve = async (...ids: string[]) => post('/ledger-outputs/approvals', sup, { outputIds: ids })
  /** Nouveau cliché (extraction plus récente) : `soldes` remplace le solde des factures citées. */
  async function snapshot(soldes: Record<string, number> = {}, extra: Inv[] = []) {
    extractionDay += 1
    const rows = [...BASE.map((r) => ({ ...r, solde: soldes[r.numero] ?? r.solde })), ...extra]
    return runImport(sup, 'receivables', receivablesFile(rows, D(extractionDay)), { controlTotal: euros(receivablesTotal(rows)) })
  }
  const output = async (id: string) => ok(await get(`/ledger-outputs?size=100`, sup)).items.find((o: any) => o.id === id)

  describe('accès', () => {
    it('[rule-recouvrement-ledger-supervisor-only] only the supervisor reads, approves, exports and writes off: 403 for the other profiles, a plain user and an admin without profile, 401 without token', async () => {
      await world()
      const out = await wo('D1', 'FA-001', 1000)
      const calls: [string, string, unknown?][] = [
        ['GET', '/ledger-outputs'], ['GET', '/ledger-outputs/counts'], ['GET', '/ledger-outputs/export'], ['POST', '/ledger-outputs/approvals', { outputIds: [out.id] }],
        ['POST', '/ledger-outputs/write-offs', { caseId: out.caseId, lines: [{ invoiceId: UNKNOWN_UUID, amountCents: 1 }], reason: 'x' }],
      ]
      for (const [method, path, body] of calls) {
        expect([method, path, (await http(method, path, undefined, body)).status]).toEqual([method, path, 401])
        for (const who of ['agent', 'lit', 'ind', 'user', 'admin'] as const) {
          const res = await http(method, path, await w.tok(who), body)
          expect([who, method, path, res.status, res.body?.code]).toEqual([who, method, path, 403, 'security.access_denied'])
        }
      }
      expect((await output(out.id)).status).toBe('to_approve')
    })
  })

  describe('passage en perte', () => {
    it('[rule-recouvrement-ledger-write-off-proposal][rule-recouvrement-ledger-output-content][rule-recouvrement-ledger-states] a write-off creates a to_approve output with its creditor entity, debtor, lines, total, reason and a stable reference', async () => {
      await world()
      const res = await writeOff('D1', 'FA-001', 30000, '  Débiteur insolvable  ')
      expectRes(res, 201)
      const out = res.body.output
      expect(Object.keys(out).sort()).toEqual(OUTPUT_KEYS)
      expect(out).toMatchObject({
        type: 'write_off', origin: 'supervisor', status: 'to_approve', creditorSiren: SIREN_A, debtorId: 'D1', commitmentId: null, amountCents: 30000,
        lines: [{ invoiceNumber: 'FA-001', amountCents: 30000 }], reason: 'Débiteur insolvable', approvedBy: null, approvedAt: null, recognizedAt: null, importsSinceApproval: 0,
      })
      expect(out.reference).toMatch(/^SC-[0-9]{6,12}$/)
      expect(out.caseId).toBe(await w.caseId('D1'))
      const second = await wo('D2', 'FB-001', 1000)
      expect(second.reference).not.toBe(out.reference)
      expect(second.creditorSiren).toBe(SIREN_B)
      const audit = ok(await get('/audit-logs?action=ledger:write-off', sup))
      expect(audit.total).toBe(2)
      expect(audit.items[0].summary).toMatch(/^Passage en perte SC-\d{6,12} proposé\.$/)
    })

    it('[rule-recouvrement-ledger-write-off-proposal] the amount of a line, added to what the non recognized outputs already cover, cannot exceed the balance of the invoice: 409 ledger.amount_exceeds_balance, and nothing is created', async () => {
      await world()
      expectRes(await writeOff('D1', 'FA-001', 100001), 409, 'ledger.amount_exceeds_balance')
      await wo('D1', 'FA-001', 60000)
      expectRes(await writeOff('D1', 'FA-001', 40001), 409, 'ledger.amount_exceeds_balance')
      expectRes(await writeOff('D1', 'FA-001', 40000), 201)
      expect(ok(await get('/ledger-outputs', sup)).total).toBe(2)
    })

    it('[rule-recouvrement-ledger-write-off-proposal] a settled case is refused 409 ledger.case_settled', async () => {
      await world()
      const caseId = await w.caseId('D3')
      const invoiceId = await w.invoiceId('FA-003')
      await sql("update base.cases set state = 'settled' where debtor_id = 'D3'")
      expectRes(await post('/ledger-outputs/write-offs', sup, { caseId, lines: [{ invoiceId, amountCents: 100 }], reason: 'x' }), 409, 'ledger.case_settled')
    })

    it('[rule-recouvrement-ledger-write-off-proposal] unknown case, unknown invoice or an invoice of another case: 404 repository.not_found', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const mine = await w.invoiceId('FA-001')
      const theirs = await w.invoiceId('FB-001')
      expectRes(await post('/ledger-outputs/write-offs', sup, { caseId: UNKNOWN_UUID, lines: [{ invoiceId: mine, amountCents: 1 }], reason: 'x' }), 404, 'repository.not_found')
      expectRes(await post('/ledger-outputs/write-offs', sup, { caseId, lines: [{ invoiceId: UNKNOWN_UUID, amountCents: 1 }], reason: 'x' }), 404, 'repository.not_found')
      expectRes(await post('/ledger-outputs/write-offs', sup, { caseId, lines: [{ invoiceId: theirs, amountCents: 1 }], reason: 'x' }), 404, 'repository.not_found')
    })

    it('[rule-recouvrement-ledger-write-off-proposal] the body is strict and bounded: 1 to 100 distinct invoices, amounts from 1 to 10 000 000 000, reason 1 to 500 characters trimmed', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const invoiceId = await w.invoiceId('FA-001')
      const line = { invoiceId, amountCents: 1 }
      const invalid: any[] = [
        {}, { caseId, lines: [line] }, { caseId, lines: [], reason: 'x' }, { caseId, lines: [line, line], reason: 'x' }, { caseId, lines: [{ invoiceId, amountCents: 0 }], reason: 'x' },
        { caseId, lines: [{ invoiceId, amountCents: 10_000_000_001 }], reason: 'x' }, { caseId, lines: [{ invoiceId, amountCents: 1.5 }], reason: 'x' }, { caseId, lines: [line], reason: '   ' },
        { caseId, lines: [line], reason: 'r'.repeat(501) }, { caseId, lines: [line], reason: 'x', extra: 1 }, { caseId: 'x', lines: [line], reason: 'x' },
        { caseId, lines: Array.from({ length: 101 }, () => ({ invoiceId: UNKNOWN_UUID, amountCents: 1 })), reason: 'x' }, { caseId, lines: [{ invoiceId, amountCents: 1, extra: 1 }], reason: 'x' },
      ]
      for (const body of invalid) expectRes(await post('/ledger-outputs/write-offs', sup, body), 400, 'api.validation.incoming_failed')
      expectRes(await post('/ledger-outputs/write-offs', sup, { caseId, lines: [line], reason: 'r'.repeat(500) }), 201)
    })
  })

  describe('liste et compteurs', () => {
    it('[rule-recouvrement-ledger-output-creation] lists are sorted newest first then by reference, filterable by status, type, creditor and case, paginated; counts per status', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 1000)
      const b = await wo('D2', 'FB-001', 2000)
      const c = await wo('D3', 'FA-003', 3000)
      await approve(b.id)
      const all = ok(await get('/ledger-outputs?size=100', sup))
      expect(all.total).toBe(3)
      expect(all.items.map((o: any) => o.id)).toEqual([c.id, b.id, a.id])
      expect(ok(await get('/ledger-outputs?status=approved', sup)).items.map((o: any) => o.id)).toEqual([b.id])
      expect(ok(await get('/ledger-outputs?status=to_approve&size=1&from=1', sup)).items.map((o: any) => o.id)).toEqual([a.id])
      expect(ok(await get('/ledger-outputs?type=write_off', sup)).total).toBe(3)
      expect(ok(await get('/ledger-outputs?type=discount_credit', sup)).total).toBe(0)
      expect(ok(await get(`/ledger-outputs?creditor=${SIREN_B}`, sup)).items.map((o: any) => o.id)).toEqual([b.id])
      expect(ok(await get(`/ledger-outputs?caseId=${c.caseId}`, sup)).items.map((o: any) => o.id)).toEqual([c.id])
      expect(ok(await get('/ledger-outputs/counts', sup))).toEqual({ to_approve: 2, approved: 1, recognized: 0, gap: 0 })
      for (const q of ['status=autre', 'type=autre', 'creditor=123', 'caseId=x', 'size=0', 'size=101', 'from=-1']) expectRes(await get(`/ledger-outputs?${q}`, sup), 400, 'api.validation.incoming_failed')
    })
  })

  describe('approbation par lot', () => {
    it('[rule-recouvrement-ledger-approve-batch] the approval records author and instant; it is traced once for the whole batch, the summary giving the count', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 1000)
      const b = await wo('D2', 'FB-001', 2000)
      const res = await approve(a.id, b.id)
      expectRes(res, 200)
      expect(res.body).toEqual({ approvedCount: 2 })
      const out = await output(a.id)
      expect(out).toMatchObject({ status: 'approved', approvedBy: { id: (await w.acc('sup')).id, email: 'sup@recette.test' } })
      expect(out.approvedAt).not.toBeNull()
      const audit = ok(await get('/audit-logs?action=ledger:approve', sup))
      expect(audit.total).toBe(1)
      expect(audit.items[0].summary).toBe('2 sorties comptables approuvées.')
    })

    it('[rule-recouvrement-ledger-states][rule-recouvrement-ledger-approve-batch] the approval is all or nothing: an output that is not to_approve gives 409 ledger.not_approvable and none is approved; an unknown id gives 404', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 1000)
      const b = await wo('D2', 'FB-001', 2000)
      await approve(a.id)
      expectRes(await approve(a.id, b.id), 409, 'ledger.not_approvable')
      expect((await output(b.id)).status).toBe('to_approve')
      expectRes(await approve(b.id, UNKNOWN_UUID), 404, 'repository.not_found')
      expect((await output(b.id)).status).toBe('to_approve')
    })

    it('[rule-recouvrement-ledger-approve-batch] the ids are 1 to 500 distinct uuids in a strict body', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 1000)
      for (const body of [{}, { outputIds: [] }, { outputIds: [a.id, a.id] }, { outputIds: ['x'] }, { outputIds: [a.id], extra: 1 }, { outputIds: Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) }]) {
        expectRes(await post('/ledger-outputs/approvals', sup, body), 400, 'api.validation.incoming_failed')
      }
      expect((await output(a.id)).status).toBe('to_approve')
    })

    it('[rule-recouvrement-ledger-states] the states are checked in the database: an output cannot leave recognized, jump from to_approve to recognized or be deleted', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 1000)
      await expect(sql("update base.ledger_outputs set status = 'recognized' where id = $1", [a.id])).rejects.toThrow()
      await expect(sql("update base.ledger_outputs set status = 'gap' where id = $1", [a.id])).rejects.toThrow()
      await expect(sql('delete from base.ledger_outputs where id = $1', [a.id])).rejects.toThrow()
      expect((await output(a.id)).status).toBe('to_approve')
    })
  })

  describe('négociable', () => {
    it('[rule-recouvrement-negotiable-outputs][rule-recouvrement-ledger-not-negotiable] an approved output deducts its lines from the negotiable amount and shows coveredByOutputsCents; a to_approve output deducts nothing', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 30000)
      expect((await w.caseDetail('D1')).negotiableCents).toBe(100000)
      await approve(a.id)
      const detail = await w.caseDetail('D1')
      expect(detail.negotiableCents).toBe(70000)
      expect(detail.invoices[0]).toMatchObject({ coveredByOutputsCents: 30000, negotiable: true })
      expect(detail.ledgerOutputs.map((o: any) => o.id)).toEqual([a.id])
    })

    it('[rule-recouvrement-ledger-not-negotiable] the deduction stops when the output is recognized', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      await snapshot({ 'FA-001': 70000 })
      expect((await output(a.id)).status).toBe('recognized')
      const detail = await w.caseDetail('D1')
      expect(detail.negotiableCents).toBe(70000)
      expect(detail.invoices[0].coveredByOutputsCents).toBe(0)
    })

    it('[rule-recouvrement-negotiable-outputs] an approved write-off lowers the amount of the first offer the agent gets', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 40000)
      await approve(a.id)
      const { RestTools, openConversation } = await import('./recouvrement-helpers')
      const agent = new RestTools(await w.tok('agent'), 'voice')
      await openConversation(agent, 'c-1', await w.caseId('D1'), await w.contactId('D1'))
      const offer = await agent.nextOffer('c-1', await w.caseId('D1'), {})
      expect(offer.body.offer.totalCents).toBe(60000)
    })
  })

  describe('export', () => {
    const download = async (token: string) => fetch(`${API_URL}/ledger-outputs/export`, { headers: { authorization: `Bearer ${token}` } })

    it('[rule-recouvrement-ledger-export] without an approved output the file holds the header only (200); it is repeatable and changes no state', async () => {
      await world()
      await wo('D1', 'FA-001', 1000)
      const res = await download(sup)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/^text\/csv; charset=utf-8/i)
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="sorties-comptables-${D(0)}.csv"`)
      expect((await res.text()).trimEnd()).toBe('identifiant,type,entite_siren,debiteur_id,factures,montant,motif')
      expect(ok(await get('/ledger-outputs/counts', sup)).to_approve).toBe(1)
    })

    it('[rule-recouvrement-ledger-export] approved outputs only are exported, one line each, with RFC 4180 quoting, invoice numbers joined by « ; », a positive amount with two decimals; neither gap nor recognized outputs', async () => {
      await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D1', montant: 50000 }, { numero: 'FB-001', debiteur: 'D2', montant: 50000, entite: SIREN_B }])
      const caseId = await w.caseId('D1')
      const two = ok(await post('/ledger-outputs/write-offs', sup, {
        caseId, lines: [{ invoiceId: await w.invoiceId('FA-001'), amountCents: 12345 }, { invoiceId: await w.invoiceId('FA-002'), amountCents: 5 }], reason: 'Motif, avec "guillemets"\net ligne',
      })).output
      const other = await wo('D2', 'FB-001', 700)
      const notApproved = await wo('D2', 'FB-001', 800)
      await approve(two.id, other.id)
      const text = await (await download(sup)).text()
      expect(text.startsWith('identifiant,type,entite_siren,debiteur_id,factures,montant,motif\n')).toBe(true)
      expect(text).toMatch(new RegExp(`${two.reference},passage_perte,${SIREN_A},D1,"?FA-001 ?; ?FA-002"?,123\\.50,"Motif, avec ""guillemets""\\net ligne"`))
      expect(text).toContain(`${other.reference},passage_perte,${SIREN_B},D2,FB-001,7.00,`)
      expect(text).not.toContain(notApproved.reference)
      expect(text.includes('\r\n')).toBe(false)
    })

    it('[rule-recouvrement-ledger-audited] reads and the export leave no audit entry', async () => {
      await world()
      await wo('D1', 'FA-001', 1000)
      await get('/ledger-outputs', sup)
      await get('/ledger-outputs/counts', sup)
      await download(sup)
      const log = ok(await get('/audit-logs?size=100', sup)).items.map((e: any) => e.action)
      expect(log.filter((a: string) => a.startsWith('ledger:') && a !== 'ledger:write-off')).toEqual([])
    })
  })

  describe('constat et écart', () => {
    it('[rule-recouvrement-ledger-recognition] a credit note carrying the reference of the output, of an absolute value at least equal to its amount, recognizes it at the next receivables import; the output gets recognizedAt', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      const run = await snapshot({}, [{ numero: 'AV-001', debiteur: 'D1', montant: -30000, type: 'avoir', referenceSortie: a.reference }])
      expect(run.conf?.status).toBe(200)
      const out = await output(a.id)
      expect(out.status).toBe('recognized')
      expect(out.recognizedAt).not.toBeNull()
    })

    it('[rule-recouvrement-ledger-recognition] a credit note smaller than the amount, or carrying another reference, does not recognize the output', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      await snapshot({}, [{ numero: 'AV-001', debiteur: 'D1', montant: -29999, type: 'avoir', referenceSortie: a.reference }])
      expect((await output(a.id)).status).toBe('approved')
      await snapshot({}, [{ numero: 'AV-002', debiteur: 'D1', montant: -30000, type: 'avoir', referenceSortie: 'SC-999999' }])
      expect((await output(a.id)).status).toBe('approved')
    })

    it('[rule-recouvrement-ledger-recognition] a balance reduced by the amount in the imported snapshot recognizes the output; a smaller reduction does not', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 30000)
      const b = await wo('D3', 'FA-003', 30000)
      await approve(a.id, b.id)
      await snapshot({ 'FA-001': 70000, 'FA-003': 50001 })
      expect((await output(a.id)).status).toBe('recognized')
      expect((await output(b.id)).status).toBe('approved')
      expect((await output(b.id)).importsSinceApproval).toBe(1)
    })

    it('[rule-recouvrement-ledger-recognition] payments applied since the approval are not counted twice: balance 100000, payment of 20000, write-off of 30000, imported balance 50000 recognizes it', async () => {
      await world()
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      await importOk(sup, 'payments', (await import('./recouvrement-helpers')).paymentsFile([{ reference: 'VIR FA-001', montant: 20000, date: D(0) }], D(0)))
      await snapshot({ 'FA-001': 50000 })
      expect((await output(a.id)).status).toBe('recognized')
    })

    it('[rule-recouvrement-ledger-gap] an approved output that the import does not reflect sees its counter grow; at ledgerMaxImports it is in gap and one accounting_gap item opens; maxImports is given for display', async () => {
      await world(BASE, { ledgerMaxImports: 2 })
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      await snapshot()
      expect(await output(a.id)).toMatchObject({ status: 'approved', importsSinceApproval: 1, maxImports: 2 })
      expect((await w.queueCounts()).byType.accounting_gap).toBe(0)
      await snapshot()
      expect(await output(a.id)).toMatchObject({ status: 'gap', importsSinceApproval: 2 })
      expect((await w.queueCounts()).byType.accounting_gap).toBe(1)
      const item = (await w.queueItems('&type=accounting_gap'))[0]
      expect(item.allowedDecisions).toEqual(['reapprove'])
      expect(ok(await get('/ledger-outputs/counts', sup)).gap).toBe(1)
    })

    it('[rule-recouvrement-ledger-not-negotiable][rule-recouvrement-ledger-gap] an output in gap keeps deducting from the negotiable amount', async () => {
      await world(BASE, { ledgerMaxImports: 1 })
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      await snapshot()
      expect((await output(a.id)).status).toBe('gap')
      expect((await w.caseDetail('D1')).negotiableCents).toBe(70000)
    })

    it('[rule-recouvrement-ledger-recognition][rule-recouvrement-queue-auto-close] a late recognition moves the gap output to recognized and closes the accounting_gap item without decision (auto_closed, no author)', async () => {
      await world(BASE, { ledgerMaxImports: 1 })
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      await snapshot()
      expect((await output(a.id)).status).toBe('gap')
      await snapshot({ 'FA-001': 70000 })
      expect((await output(a.id)).status).toBe('recognized')
      const closed = (await w.queueItems('&status=decided&type=accounting_gap'))[0]
      expect(closed.decision).toMatchObject({ code: 'auto_closed', decidedBy: null })
      expect(closed.allowedDecisions).toEqual([])
      expect((await w.queueCounts()).byType.accounting_gap).toBe(0)
    })

    it('[rule-recouvrement-queue-effects][rule-recouvrement-ledger-states] the decision « reapprove » puts a gap output back to approved with a counter at 0; it then counts imports again', async () => {
      await world(BASE, { ledgerMaxImports: 1 })
      const a = await wo('D1', 'FA-001', 30000)
      await approve(a.id)
      await snapshot()
      const item = (await w.queueItems('&type=accounting_gap'))[0]
      const res = await post(`/decision-queue/items/${item.id}/decision`, sup, { decision: 'reapprove', reason: 'Saisie comptable en retard' })
      expectRes(res, 200)
      expect(res.body.item.status).toBe('decided')
      expect(await output(a.id)).toMatchObject({ status: 'approved', importsSinceApproval: 0 })
      await snapshot()
      expect((await output(a.id)).status).toBe('gap')
    })

  })

  describe('pas de comptabilité directe', () => {
    it('[rule-recouvrement-ledger-no-direct-accounting] no route reads or writes an accounting tool: the only ledger routes are the five listed ones', async () => {
      await world()
      for (const [method, path] of [['GET', '/ledger-outputs/sync'], ['POST', '/ledger-outputs/push'], ['POST', '/ledger-outputs/sync'], ['GET', '/accounting'], ['POST', '/accounting/export']]) {
        const res = await http(method, path, sup)
        expect([method, path, [404, 405].includes(res.status) || res.status === 400]).toEqual([method, path, true])
      }
      expect((await http('PUT', '/ledger-outputs', sup, {})).status).toBeGreaterThanOrEqual(400)
    })
  })
})
