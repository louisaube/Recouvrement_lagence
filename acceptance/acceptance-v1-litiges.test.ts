import { resetData, closePool } from './harness'
import {
  World, get, post, http, expectRes, ok, UNKNOWN_UUID, setupWorld, daysFromToday, importOk, strip, DISPUTES_HEADER, RestTools, openConversation, SIREN_A,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : litiges et contestations (service litiges).

const D = (n: number) => daysFromToday(n)
const DISPUTE_KEYS = ['balanceCents', 'caseId', 'caseState', 'closedAt', 'creditorSiren', 'debtorId', 'id', 'invoiceNumber', 'openedAt', 'origin', 'owner', 'reason', 'status']
const DETAIL_KEYS = [...DISPUTE_KEYS, 'case', 'closeNote', 'closedBy', 'contestation', 'invoice', 'openedBy'].sort()

describe('Recouvrement - litiges', () => {
  let w: World
  let lit: string
  let sup: string

  beforeEach(async () => {
    await resetData()
    w = new World()
  })
  afterAll(async () => {
    await closePool()
  })

  const PORTFOLIO: Inv[] = [
    { numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D1', montant: 40000 },
    { numero: 'FA-003', debiteur: 'D2', montant: 70000 }, { numero: 'FA-004', debiteur: 'D3', montant: 30000, solde: 0 },
  ]
  async function world(invoices: Inv[] = PORTFOLIO) {
    await setupWorld({ invoices }, w)
    sup = await w.tok('sup')
    lit = await w.tok('lit')
  }
  const openDispute = async (number: string, over: object = {}) => {
    const invoices = ok(await get(`/disputes/invoices?number=${encodeURIComponent(number)}`, lit)).items
    return post('/disputes', lit, { invoiceId: invoices.find((i: any) => i.number === number).id, reason: 'Prestation contestée', owner: 'Service client', ...over })
  }

  describe('accès', () => {
    it('[rule-recouvrement-disputes-litigation-only] only the litigation service reaches the dispute routes: the supervisor too gets 403 security.access_denied, as the agent, the indicators reader, a plain user and an admin without profile; 401 without token; the 403 comes before the validation', async () => {
      await world()
      const d = ok(await openDispute('FA-001')).dispute
      const calls: [string, string, unknown?][] = [
        ['GET', '/disputes'], ['GET', `/disputes/${d.id}`], ['GET', '/disputes/invoices?number=FA'], ['POST', '/disputes', { invoiceId: d.invoice.id, reason: 'x', owner: 'x' }],
        ['POST', '/disputes', { nope: 1 }], ['POST', `/disputes/${d.id}/close`, { note: 'x' }],
      ]
      for (const [method, path, body] of calls) {
        expect([method, path, (await http(method, path, undefined, body)).status]).toEqual([method, path, 401])
        for (const who of ['sup', 'agent', 'ind', 'user', 'admin'] as const) {
          const res = await http(method, path, await w.tok(who), body)
          expect([who, method, path, res.status, res.body?.code]).toEqual([who, method, path, 403, 'security.access_denied'])
        }
      }
    })

    it('[rule-recouvrement-disputes-litigation-only] the litigation service reads neither the case card, the decisions, the policy, the queue nor the indicators', async () => {
      await world()
      const caseId = await w.caseId('D1')
      for (const path of ['/cases', `/cases/${caseId}`, `/cases/${caseId}/decisions`, `/cases/${caseId}/state-history`, '/policy-versions', '/decision-queue/items', '/indicators', '/ledger-outputs', '/review-samples', '/daily-batches', '/recovery-imports/status']) {
        const res = await get(path, lit)
        expect([path, res.status, res.body?.code]).toEqual([path, 403, 'security.access_denied'])
      }
    })
  })

  describe('ouverture', () => {
    it('[rule-recouvrement-dispute-open-freezes] opening a dispute freezes the invoice: it leaves the negotiable amount, the dispute shows the case summary; the case goes frozen only if all its open invoices are frozen (cause dispute_opened)', async () => {
      await world()
      const first = await openDispute('FA-001', { reason: '  Prestation non livrée  ', owner: '  Marie  ' })
      expectRes(first, 201)
      expect(Object.keys(first.body.dispute).sort()).toEqual(DETAIL_KEYS)
      expect(first.body.dispute).toMatchObject({
        status: 'open', origin: 'service', invoiceNumber: 'FA-001', creditorSiren: SIREN_A, balanceCents: 100000, debtorId: 'D1', caseState: 'open', reason: 'Prestation non livrée', owner: 'Marie',
        closedAt: null, closeNote: null, closedBy: null, contestation: null, openedBy: { id: (await w.acc('lit')).id, email: 'lit@recette.test' },
        invoice: { number: 'FA-001', frozen: true, balanceCents: 100000, debtorId: 'D1' }, case: { debtorId: 'D1', nature: 'family', state: 'open', openInvoices: 2, frozenInvoices: 1 },
      })
      expect((await w.caseDetail('D1')).negotiableCents).toBe(40000)
      expect((await w.caseDetail('D1')).state).toBe('open')
      await openDispute('FA-002')
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('frozen')
      const history = ok(await get(`/cases/${detail.id}/state-history`, sup)).items
      expect(history[0]).toMatchObject({ from: 'open', to: 'frozen', cause: 'dispute_opened' })
    })

    it('[rule-recouvrement-dispute-one-open-per-invoice] a second open dispute on the same invoice is refused 409 disputes.already_open', async () => {
      await world()
      expectRes(await openDispute('FA-001'), 201)
      const invoiceId = ok(await get('/disputes/invoices?number=FA-001', lit)).items[0].id
      const res = await post('/disputes', lit, { invoiceId, reason: 'bis', owner: 'x' })
      expectRes(res, 409, 'disputes.already_open')
      expect(ok(await get('/disputes', lit)).total).toBe(1)
    })

    it('[rule-recouvrement-dispute-one-open-per-invoice] an unknown invoice or a settled one is 404 repository.not_found; the body is strict and bounded (reason 1..500, owner 1..100, trimmed)', async () => {
      await world()
      expectRes(await post('/disputes', lit, { invoiceId: UNKNOWN_UUID, reason: 'x', owner: 'x' }), 404, 'repository.not_found')
      const settledId = await w.invoiceId('FA-004').catch(() => UNKNOWN_UUID)
      expectRes(await post('/disputes', lit, { invoiceId: settledId, reason: 'x', owner: 'x' }), 404, 'repository.not_found')
      const invoiceId = ok(await get('/disputes/invoices?number=FA-003', lit)).items[0].id
      for (const body of [{}, { invoiceId, reason: 'x' }, { invoiceId, owner: 'x' }, { invoiceId, reason: '', owner: 'x' }, { invoiceId, reason: '   ', owner: 'x' }, { invoiceId, reason: 'r'.repeat(501), owner: 'x' }, { invoiceId, reason: 'x', owner: '' }, { invoiceId, reason: 'x', owner: 'o'.repeat(101) }, { invoiceId, reason: 'x', owner: 'x', extra: 1 }, { invoiceId: 'x', reason: 'x', owner: 'x' }]) {
        expectRes(await post('/disputes', lit, body), 400, 'api.validation.incoming_failed')
      }
      expectRes(await post('/disputes', lit, { invoiceId, reason: 'r'.repeat(500), owner: 'o'.repeat(100) }), 201)
    })

    it('[rule-recouvrement-dispute-text-plain] reasons and notes are kept as plain text, exactly as typed (no HTML interpretation or escaping on the server)', async () => {
      await world()
      const text = '<script>alert(1)</script> & "guillemets" <b>gras</b>'
      const res = await openDispute('FA-001', { reason: text })
      expectRes(res, 201)
      expect(res.body.dispute.reason).toBe(text)
      const read = ok(await get(`/disputes/${res.body.dispute.id}`, lit)).dispute
      expect(read.reason).toBe(text)
    })

    it('[rule-recouvrement-disputes-litigation-only] opening and closing are traced with the dispute object type and a summary without reason or note', async () => {
      await world()
      const d = ok(await openDispute('FA-001', { reason: 'Motif secret' })).dispute
      await post(`/disputes/${d.id}/close`, lit, { note: 'Note secrète' })
      const log = ok(await get('/audit-logs?size=100', sup)).items
      const opened = log.find((e: any) => e.action === 'disputes:open')
      const closed = log.find((e: any) => e.action === 'disputes:close')
      expect(opened.summary).toBe('Litige ouvert sur la facture FA-001.')
      expect(closed.summary).toBe('Litige clos sur la facture FA-001.')
      expect(JSON.stringify(log)).not.toMatch(/secret/)
    })
  })

  describe('clôture', () => {
    it('[rule-recouvrement-dispute-close-unfreezes][rule-recouvrement-dispute-no-delete] closing unfreezes the invoice and re-evaluates the case (freeze_released); a closed dispute is not reopened (409 disputes.already_closed) nor deleted', async () => {
      await world()
      await openDispute('FA-001')
      const d2 = ok(await openDispute('FA-002')).dispute
      expect((await w.caseDetail('D1')).state).toBe('frozen')
      const res = await post(`/disputes/${d2.id}/close`, lit, { note: '  Réglé à l\'amiable  ' })
      expectRes(res, 200)
      expect(res.body.dispute).toMatchObject({ status: 'closed', closeNote: 'Réglé à l\'amiable', closedBy: { id: (await w.acc('lit')).id, email: 'lit@recette.test' }, invoice: { frozen: false } })
      expect(res.body.dispute.closedAt).not.toBeNull()
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('open')
      expect(detail.negotiableCents).toBe(40000)
      expect(ok(await get(`/cases/${detail.id}/state-history`, sup)).items[0]).toMatchObject({ from: 'frozen', to: 'open', cause: 'freeze_released' })
      expectRes(await post(`/disputes/${d2.id}/close`, lit, { note: 'bis' }), 409, 'disputes.already_closed')
      expect((await http('DELETE', `/disputes/${d2.id}`, lit)).status).toBe(404)
      const again = await openDispute('FA-002')
      expectRes(again, 201)
      expect(again.body.dispute.id).not.toBe(d2.id)
    })

    it('[rule-recouvrement-dispute-close-unfreezes] closing a dispute born from an import unfreezes its invoice', async () => {
      await world()
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-001', '', 'Litige import', 'Service', D(-1)]]))
      const imported = ok(await get('/disputes', lit)).items[0]
      expect(imported.origin).toBe('import')
      expect((await w.caseDetail('D1')).invoices.find((i: any) => i.number === 'FA-001').frozen).toBe(true)
      const closed = await post(`/disputes/${imported.id}/close`, lit, { note: 'ok' })
      expect(closed.body.dispute.invoice.frozen).toBe(false)
      expect((await w.caseDetail('D1')).negotiableCents).toBe(140000)
    })

    it('[rule-recouvrement-dispute-close-unfreezes][rule-recouvrement-dispute-contestation-origin] a dispute born from a contestation carries its text; the case freeze « contestation » is lifted when the last dispute born from this contestation is closed', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const agent = new RestTools(await w.tok('agent'), 'voice')
      await openConversation(agent, 'c-1', caseId, await w.contactId('D1'))
      const text = 'Je ne dois rien : la facture est déjà payée.'
      expect((await agent.contest('c-1', caseId, { reason: text, invoiceNumbers: ['FA-001', 'FA-002'] })).status).toBe(201)
      const list = ok(await get('/disputes?origin=contestation', lit)).items
      expect(list).toHaveLength(2)
      expect((await w.caseDetail('D1')).state).toBe('frozen')
      const detail = ok(await get(`/disputes/${list[0].id}`, lit)).dispute
      expect(detail).toMatchObject({ origin: 'contestation', openedBy: null, contestation: { channel: 'voice', conversationId: 'c-1', text } })
      expect(detail.contestation.statedAt).toEqual(expect.any(String))
      await post(`/disputes/${list[0].id}/close`, lit, { note: 'première' })
      expect((await w.caseDetail('D1')).state).toBe('frozen')
      await post(`/disputes/${list[1].id}/close`, lit, { note: 'seconde' })
      const after = await w.caseDetail('D1')
      expect(after.freezes).toEqual([])
      expect(after.state).toBe('open')
    })

    it('[rule-recouvrement-dispute-one-open-per-invoice] a contestation on an invoice already in dispute creates no second dispute: the contestation is attached to the existing one', async () => {
      await world()
      await openDispute('FA-001')
      const caseId = await w.caseId('D1')
      const agent = new RestTools(await w.tok('agent'), 'voice')
      await openConversation(agent, 'c-1', caseId, await w.contactId('D1'))
      expect((await agent.contest('c-1', caseId, { reason: 'Contestation', invoiceNumbers: ['FA-001'] })).status).toBe(201)
      const open_ = ok(await get('/disputes?size=100', lit))
      expect(open_.total).toBe(1)
      expect(open_.items[0].origin).toBe('service')
    })

    it('[rule-recouvrement-dispute-close-unfreezes] the note is required (1..500 trimmed), the body strict, the id a uuid; unknown dispute: 404', async () => {
      await world()
      const d = ok(await openDispute('FA-001')).dispute
      for (const body of [{}, { note: '' }, { note: '   ' }, { note: 'n'.repeat(501) }, { note: 'x', extra: 1 }, { note: 5 }]) {
        expectRes(await post(`/disputes/${d.id}/close`, lit, body), 400, 'api.validation.incoming_failed')
      }
      expectRes(await post('/disputes/x/close', lit, { note: 'x' }), 400, 'api.validation.incoming_failed')
      expectRes(await post(`/disputes/${UNKNOWN_UUID}/close`, lit, { note: 'x' }), 404, 'repository.not_found')
      expectRes(await post(`/disputes/${d.id}/close`, lit, { note: 'n'.repeat(500) }), 200)
    })
  })

  describe('lecture', () => {
    it('[rule-recouvrement-disputes-litigation-only] the list shows open disputes oldest first by default, closed ones newest closed first, all of them with status all; filters by origin and search (invoice number or customer id, case-insensitive substring); pagination bounded', async () => {
      await world()
      const a = ok(await openDispute('FA-001')).dispute
      const b = ok(await openDispute('FA-003')).dispute
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-002', '', 'Litige import', 'Service', D(-1)]]))
      const open_ = ok(await get('/disputes?size=100', lit))
      expect(open_.total).toBe(3)
      expect(open_.items.map((d: any) => d.openedAt)).toEqual([...open_.items.map((d: any) => d.openedAt)].sort())
      expect(Object.keys(open_.items[0]).sort()).toEqual(DISPUTE_KEYS)
      await post(`/disputes/${a.id}/close`, lit, { note: 'a' })
      await post(`/disputes/${b.id}/close`, lit, { note: 'b' })
      expect(ok(await get('/disputes?status=closed', lit)).items.map((d: any) => d.id)).toEqual([b.id, a.id])
      expect(ok(await get('/disputes?status=all&size=100', lit)).total).toBe(3)
      expect(ok(await get('/disputes?status=all&origin=import', lit)).items.map((d: any) => d.invoiceNumber)).toEqual(['FA-002'])
      expect(ok(await get('/disputes?status=all&origin=service', lit)).total).toBe(2)
      expect(ok(await get('/disputes?status=all&search=fa-003', lit)).items.map((d: any) => d.id)).toEqual([b.id])
      expect(ok(await get('/disputes?status=all&search=d1', lit)).total).toBe(2)
      expect(ok(await get('/disputes?status=all&search=%25', lit)).total).toBe(0)
      for (const q of ['status=autre', 'origin=autre', 'search=', `search=${'a'.repeat(51)}`, 'size=0', 'size=101', 'from=-1']) expectRes(await get(`/disputes?${q}`, lit), 400, 'api.validation.incoming_failed')
      expectRes(await get(`/disputes/${UNKNOWN_UUID}`, lit), 404, 'repository.not_found')
      expectRes(await get('/disputes/x', lit), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-disputes-litigation-only] the invoice search is by number prefix without regard to case, open invoices with a positive balance only, sorted by number; the number is required', async () => {
      await world()
      const res = await get('/disputes/invoices?number=fa-00&size=100', lit)
      expectRes(res, 200)
      expect(res.body.items.map((i: any) => i.number)).toEqual(['FA-001', 'FA-002', 'FA-003'])
      expect(Object.keys(res.body.items[0]).sort()).toEqual(['balanceCents', 'creditorSiren', 'debtorId', 'frozen', 'id', 'number'])
      expect(res.body.total).toBe(3)
      for (const q of ['', 'number=', `number=${'a'.repeat(51)}`, 'number=F&size=0', 'number=F&size=101']) expectRes(await get(`/disputes/invoices?${q}`, lit), 400, 'api.validation.incoming_failed')
    })
  })
})
